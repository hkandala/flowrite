use std::{
    collections::HashMap, io::Write as IoWrite, path::PathBuf, str::FromStr, sync::Arc,
    time::Duration,
};

use sacp::{
    schema::{
        AvailableCommandInput, CancelNotification, ContentBlock, CurrentModeUpdate,
        InitializeRequest, PermissionOptionKind, PlanEntryStatus, ProtocolVersion,
        RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
        SelectedPermissionOutcome, SessionNotification, SessionUpdate, SetSessionModeRequest,
        StopReason, ToolCall, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind,
    },
    util::MatchMessage,
    ClientToAgent, SessionMessage,
};
use sacp_tokio::{AcpAgent, LineDirection};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};

type AcpProcessLog = Arc<std::sync::Mutex<std::io::BufWriter<std::fs::File>>>;

fn create_acp_log_file(
    app_handle: &AppHandle,
    agent_id: &str,
) -> Result<(AcpProcessLog, PathBuf), String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("failed to get app log dir: {e}"))?
        .join("acp");
    std::fs::create_dir_all(&log_dir).map_err(|e| format!("failed to create acp log dir: {e}"))?;
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S");
    let filename = format!("{agent_id}_{timestamp}.log");
    let path = log_dir.join(&filename);
    let file =
        std::fs::File::create(&path).map_err(|e| format!("failed to create log file: {e}"))?;
    let writer = std::io::BufWriter::new(file);
    Ok((Arc::new(std::sync::Mutex::new(writer)), path))
}

fn write_acp_log(log: &AcpProcessLog, direction: &str, line: &str) {
    if let Ok(mut writer) = log.lock() {
        let ts = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
        let _ = writeln!(writer, "[{ts}] [{direction}] {line}");
        let _ = writer.flush();
    }
}

fn cleanup_old_acp_logs(app_handle: &AppHandle, max_age: Duration) {
    let log_dir = match app_handle.path().app_log_dir() {
        Ok(dir) => dir.join("acp"),
        Err(_) => return,
    };
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if let Ok(modified) = metadata.modified() {
                    if modified.elapsed().unwrap_or_default() > max_age {
                        let _ = std::fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}

pub struct AcpState(pub(crate) tokio::sync::Mutex<AcpStateInner>);

#[derive(Default)]
pub(crate) struct AcpStateInner {
    /// One entry per running agent process, keyed by caller-provided agent_id.
    agents: HashMap<String, AgentHandle>,
}

struct AgentHandle {
    /// Send commands into the background run_until task.
    command_tx: mpsc::Sender<AgentCommand>,
    /// Timestamp of the last interaction with this agent.
    last_used: std::time::Instant,
    /// Last JSON-RPC error captured from the wire (for fallback error messages).
    captured_error: CapturedError,
    /// Path to the per-process raw wire log file.
    log_file: Option<PathBuf>,
}

impl Default for AcpState {
    fn default() -> Self {
        Self(tokio::sync::Mutex::new(AcpStateInner {
            agents: HashMap::new(),
        }))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub agent_id: String,
    pub name: String,
    pub version: String,
    pub auth_methods: Vec<AuthMethodInfo>,
    pub log_file: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethodInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub available_modes: Vec<SessionModeInfo>,
    pub current_mode_id: Option<String>,
    pub available_commands: Vec<SlashCommandInfo>,
    pub available_models: Vec<ModelInfoData>,
    pub current_model_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandInfo {
    pub name: String,
    pub description: String,
    pub input_hint: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfoData {
    pub model_id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcpConnectionError {
    kind: String,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionInfo {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntryInfo {
    pub content: String,
    pub status: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffInfo {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum AgentEvent {
    MessageChunk {
        text: String,
    },
    ThinkingChunk {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolCallUpdate {
        tool_call_id: String,
        title: String,
        kind: String,
        status: String,
        content: Option<String>,
        locations: Option<Vec<String>>,
        diff_data: Option<DiffInfo>,
    },
    #[serde(rename_all = "camelCase")]
    PermissionRequest {
        request_id: String,
        tool_call_id: String,
        title: Option<String>,
        options: Vec<PermissionOptionInfo>,
    },
    PlanUpdate {
        entries: Vec<PlanEntryInfo>,
    },
    #[serde(rename_all = "camelCase")]
    ModeUpdate {
        current_mode_id: String,
    },
    CommandsUpdate {
        commands: Vec<SlashCommandInfo>,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        stop_reason: String,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentCrashPayload {
    agent_id: String,
    kind: String,
    message: String,
}

enum AgentCommand {
    GetInfo {
        respond_to: oneshot::Sender<Result<AgentInfo, String>>,
    },
    NewSession {
        cwd: String,
        respond_to: oneshot::Sender<Result<SessionInfo, String>>,
    },
    Prompt {
        session_id: String,
        text: String,
        on_event: Channel<AgentEvent>,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
    RespondPermission {
        request_id: String,
        option_id: String,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
    Cancel {
        session_id: String,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
    SetMode {
        session_id: String,
        mode_id: String,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
    SetModel {
        session_id: String,
        model_id: String,
        respond_to: oneshot::Sender<Result<(), String>>,
    },
}

#[allow(dead_code)]
struct ActivePromptHandle {
    session_id: String,
}

struct PendingPermission {
    session_id: String,
    decision_tx: oneshot::Sender<Option<String>>,
}

#[derive(Default)]
struct RuntimeShared {
    active_streams: HashMap<String, ActiveStream>,
    pending_permissions: HashMap<String, PendingPermission>,
    next_permission_request_id: u64,
}

#[derive(Clone)]
#[allow(dead_code)]
struct ActiveStream {
    session_id: String,
    channel: Channel<AgentEvent>,
}

type InitSender = Arc<tokio::sync::Mutex<Option<oneshot::Sender<Result<AgentInfo, String>>>>>;

const MAX_AGENT_PROCESSES: usize = 5;

fn compute_agent_id(command: &str, env: &HashMap<String, String>) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    command.hash(&mut hasher);
    let mut sorted_env: Vec<_> = env.iter().collect();
    sorted_env.sort_by_key(|(k, _)| (*k).clone());
    for (k, v) in sorted_env {
        k.hash(&mut hasher);
        v.hash(&mut hasher);
    }
    format!("agent-{:016x}", hasher.finish())
}

#[tauri::command]
pub async fn acp_connect(
    app_handle: AppHandle,
    state: State<'_, AcpState>,
    command: String,
    env: HashMap<String, String>,
) -> Result<AgentInfo, String> {
    let agent_id = compute_agent_id(&command, &env);
    log::info!("[acp] acp_connect agent_id={agent_id} command='{command}'");
    if let Some(existing_tx) = {
        let mut inner = state.0.lock().await;
        if let Some(handle) = inner.agents.get_mut(&agent_id) {
            handle.last_used = std::time::Instant::now();
            Some(handle.command_tx.clone())
        } else {
            None
        }
    } {
        log::info!("[acp] acp_connect agent_id={agent_id} reused");
        let info_result = request_agent_info(existing_tx).await;
        return info_result;
    }

    // LRU eviction: if at capacity, remove the least recently used agent
    {
        let mut inner = state.0.lock().await;
        if inner.agents.len() >= MAX_AGENT_PROCESSES {
            let oldest = inner
                .agents
                .iter()
                .min_by_key(|(_, handle)| handle.last_used)
                .map(|(id, _)| id.clone());
            if let Some(evict_id) = oldest {
                log::info!("[acp] acp_connect evicting agent_id={evict_id}");
                inner.agents.remove(&evict_id);
            }
        }
    }

    let (command_tx, command_rx) = mpsc::channel(64);
    let (init_tx, init_rx) = oneshot::channel();
    let captured_error: CapturedError = Arc::new(std::sync::Mutex::new(None));

    {
        let mut inner = state.0.lock().await;
        inner.agents.insert(
            agent_id.clone(),
            AgentHandle {
                command_tx: command_tx.clone(),
                last_used: std::time::Instant::now(),
                captured_error: captured_error.clone(),
                log_file: None,
            },
        );
    }

    let spawned_agent_id = agent_id.clone();
    let spawned_app_handle = app_handle.clone();
    let spawned_captured_error = captured_error.clone();
    tauri::async_runtime::spawn(async move {
        run_agent_task(
            spawned_app_handle,
            spawned_agent_id,
            command,
            env,
            command_rx,
            init_tx,
            spawned_captured_error,
        )
        .await;
    });

    let connect_result = match tokio::time::timeout(Duration::from_secs(30), init_rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => {
            remove_agent_handle(&state, &agent_id).await;
            Err("failed to receive initialization result".to_string())
        }
        Err(_) => {
            remove_agent_handle(&state, &agent_id).await;
            Err("agent initialization timed out".to_string())
        }
    };

    match &connect_result {
        Ok(info) => log::info!(
            "[acp] acp_connect agent_id={agent_id} -> ok name={} version={}",
            info.name,
            info.version
        ),
        Err(error) => log::error!("[acp] acp_connect agent_id={agent_id} -> error: {error}"),
    }

    connect_result
}

#[tauri::command]
pub async fn acp_new_session(
    state: State<'_, AcpState>,
    agent_id: String,
    cwd: String,
) -> Result<SessionInfo, String> {
    log::info!("[acp] acp_new_session agent_id={agent_id}");
    let (command_tx, captured_error) = get_agent_handle_parts(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::NewSession { cwd, respond_to })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx.await.map_err(|_| {
        // The respond_to sender was dropped (agent crashed/exited during session creation).
        // Check if we captured a JSON-RPC error from the wire before the crash.
        if let Ok(guard) = captured_error.lock() {
            if let Some(wire_err) = guard.as_ref() {
                let kind = if wire_err.code == -32000 {
                    "auth_required"
                } else if wire_err.code == -32603 {
                    "internal"
                } else {
                    "unknown"
                };
                let detail = extract_wire_error_detail(wire_err);
                let conn_err = AcpConnectionError {
                    kind: kind.to_string(),
                    message: detail,
                };
                return connection_error_to_string(&conn_err);
            }
        }
        format!("agent '{agent_id}' did not respond")
    })?;

    match &result {
        Ok(session) => log::info!(
            "[acp] acp_new_session agent_id={agent_id} -> session_id={}",
            session.session_id
        ),
        Err(error) => log::error!("[acp] acp_new_session agent_id={agent_id} -> error: {error}"),
    }

    result
}

#[tauri::command]
pub async fn acp_prompt(
    state: State<'_, AcpState>,
    agent_id: String,
    session_id: String,
    text: String,
    on_event: Channel<AgentEvent>,
) -> Result<(), String> {
    let prompt_len = text.chars().count();
    log::info!("[acp] acp_prompt agent_id={agent_id} session_id={session_id} chars={prompt_len}");
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    let session_id_log = session_id.clone();
    command_tx
        .send(AgentCommand::Prompt {
            session_id,
            text,
            on_event,
            respond_to,
        })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(()) => {
            log::info!("[acp] acp_prompt agent_id={agent_id} session_id={session_id_log} -> done")
        }
        Err(error) => log::warn!(
            "[acp] acp_prompt agent_id={agent_id} session_id={session_id_log} -> error: {error}"
        ),
    }

    result
}

#[tauri::command]
pub async fn acp_respond_permission(
    state: State<'_, AcpState>,
    agent_id: String,
    request_id: String,
    option_id: String,
) -> Result<(), String> {
    log::info!(
        "[acp] acp_respond_permission agent_id={agent_id} request_id={request_id} option_id={option_id}"
    );
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::RespondPermission {
            request_id,
            option_id,
            respond_to,
        })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(()) => log::info!("[acp] acp_respond_permission agent_id={agent_id} -> done"),
        Err(error) => {
            log::warn!("[acp] acp_respond_permission agent_id={agent_id} -> error: {error}")
        }
    }

    result
}

#[tauri::command]
pub async fn acp_cancel(
    state: State<'_, AcpState>,
    agent_id: String,
    session_id: String,
) -> Result<(), String> {
    log::info!("[acp] acp_cancel agent_id={agent_id} session_id={session_id}");
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::Cancel {
            session_id,
            respond_to,
        })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(()) => log::info!("[acp] acp_cancel agent_id={agent_id} -> done"),
        Err(error) => log::warn!("[acp] acp_cancel agent_id={agent_id} -> error: {error}"),
    }

    result
}

#[tauri::command]
pub async fn acp_set_mode(
    state: State<'_, AcpState>,
    agent_id: String,
    session_id: String,
    mode_id: String,
) -> Result<(), String> {
    log::info!("[acp] acp_set_mode agent_id={agent_id} session_id={session_id} mode_id={mode_id}");
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::SetMode {
            session_id,
            mode_id,
            respond_to,
        })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(()) => log::info!("[acp] acp_set_mode agent_id={agent_id} -> done"),
        Err(error) => log::warn!("[acp] acp_set_mode agent_id={agent_id} -> error: {error}"),
    }

    result
}

#[tauri::command]
pub async fn acp_set_model(
    state: State<'_, AcpState>,
    agent_id: String,
    session_id: String,
    model_id: String,
) -> Result<(), String> {
    log::info!(
        "[acp] acp_set_model agent_id={agent_id} session_id={session_id} model_id={model_id}"
    );
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::SetModel {
            session_id,
            model_id,
            respond_to,
        })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(()) => log::info!("[acp] acp_set_model agent_id={agent_id} -> done"),
        Err(error) => log::warn!("[acp] acp_set_model agent_id={agent_id} -> error: {error}"),
    }

    result
}

#[allow(clippy::type_complexity)]
async fn get_agent_command_tx(
    state: &State<'_, AcpState>,
    agent_id: &str,
) -> Result<mpsc::Sender<AgentCommand>, String> {
    let mut inner = state.0.lock().await;
    if let Some(handle) = inner.agents.get_mut(agent_id) {
        handle.last_used = std::time::Instant::now();
        Ok(handle.command_tx.clone())
    } else {
        Err(format!("agent '{agent_id}' is not connected"))
    }
}

async fn get_agent_handle_parts(
    state: &State<'_, AcpState>,
    agent_id: &str,
) -> Result<(mpsc::Sender<AgentCommand>, CapturedError), String> {
    let mut inner = state.0.lock().await;
    if let Some(handle) = inner.agents.get_mut(agent_id) {
        handle.last_used = std::time::Instant::now();
        Ok((handle.command_tx.clone(), handle.captured_error.clone()))
    } else {
        Err(format!("agent '{agent_id}' is not connected"))
    }
}

async fn request_agent_info(command_tx: mpsc::Sender<AgentCommand>) -> Result<AgentInfo, String> {
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::GetInfo { respond_to })
        .await
        .map_err(|_| "agent is not running".to_string())?;
    response_rx
        .await
        .map_err(|_| "agent did not respond".to_string())?
}

async fn remove_agent_handle(state: &AcpState, agent_id: &str) {
    let mut inner = state.0.lock().await;
    inner.agents.remove(agent_id);
}

async fn run_agent_task(
    app_handle: AppHandle,
    agent_id: String,
    command: String,
    env: HashMap<String, String>,
    command_rx: mpsc::Receiver<AgentCommand>,
    init_tx: oneshot::Sender<Result<AgentInfo, String>>,
    captured_error: CapturedError,
) {
    let init_sender = Arc::new(tokio::sync::Mutex::new(Some(init_tx)));
    let shared = Arc::new(tokio::sync::Mutex::new(RuntimeShared::default()));

    cleanup_old_acp_logs(&app_handle, Duration::from_secs(7 * 24 * 3600));

    let (process_log, log_path) = match create_acp_log_file(&app_handle, &agent_id) {
        Ok(result) => result,
        Err(message) => {
            log::error!("[acp] failed to create log file for agent_id={agent_id}: {message}");
            if let Some(init_tx) = init_sender.lock().await.take() {
                let _ = init_tx.send(Err(message.clone()));
            }
            emit_agent_crashed(&app_handle, &agent_id, &message);
            remove_agent_handle_from_app_state(&app_handle, &agent_id).await;
            return;
        }
    };
    let log_path_string = log_path.to_string_lossy().to_string();
    log::info!("[acp] process started agent_id={agent_id} log_file={log_path_string}");
    set_agent_log_file(&app_handle, &agent_id, log_path).await;

    let (acp_agent, captured_models, captured_commands) = match build_agent(
        &agent_id,
        command,
        env,
        captured_error.clone(),
        process_log.clone(),
    ) {
        Ok(agent) => agent,
        Err(message) => {
            log::error!("[acp][{agent_id}] failed to build agent command: {message}");
            if let Some(init_tx) = init_sender.lock().await.take() {
                let _ = init_tx.send(Err(message.clone()));
            }
            emit_agent_crashed(&app_handle, &agent_id, &message);
            remove_agent_handle_from_app_state(&app_handle, &agent_id).await;
            return;
        }
    };

    let shared_for_permissions = shared.clone();
    let permission_agent_id = agent_id.clone();
    let connection_result = ClientToAgent::builder()
        .name("flowrite")
        .on_receive_request(
            async move |request: RequestPermissionRequest, request_cx, _cx| {
                handle_permission_request(
                    permission_agent_id.clone(),
                    shared_for_permissions.clone(),
                    request,
                    request_cx,
                )
                .await
            },
            sacp::on_receive_request!(),
        )
        .connect_to(acp_agent);

    let loop_agent_id = agent_id.clone();
    let run_result: Result<(), String> = match connection_result {
        Ok(connection) => connection
            .run_until({
                let shared = shared.clone();
                let init_sender = init_sender.clone();
                move |cx| {
                    run_agent_command_loop(
                        loop_agent_id,
                        cx,
                        command_rx,
                        shared,
                        init_sender,
                        captured_models,
                        captured_commands,
                        log_path_string,
                    )
                }
            })
            .await
            .map_err(|error| error.to_string()),
        Err(error) => {
            log::error!("[acp][{agent_id}] failed to establish ACP connection: {error}");
            Err(error.to_string())
        }
    };

    remove_agent_handle_from_app_state(&app_handle, &agent_id).await;

    if let Some(init_tx) = init_sender.lock().await.take() {
        let fallback = "agent connection ended unexpectedly".to_string();
        let init_message = match run_result.as_ref() {
            Ok(()) => fallback,
            Err(error) => error.clone(),
        };
        let _ = init_tx.send(Err(init_message));
    }

    if let Err(message) = run_result {
        log::error!("[acp] process crashed agent_id={agent_id}: {message}");
        // Check if we captured a structured error from the wire for a better crash message
        let wire_err = captured_error.lock().ok().and_then(|guard| guard.clone());
        if let Some(wire_err) = wire_err {
            let kind = if wire_err.code == -32000 {
                "auth_required"
            } else if wire_err.code == -32603 {
                "internal"
            } else {
                "crashed"
            };
            let detail = extract_wire_error_detail(&wire_err);
            emit_agent_crashed_with_kind(&app_handle, &agent_id, kind, &detail);
        } else {
            let clean = clean_sacp_error_message(&message);
            emit_agent_crashed(&app_handle, &agent_id, &clean);
        }
    } else {
        log::info!("[acp] process ended agent_id={agent_id}");
    }
}

async fn run_agent_command_loop(
    agent_id: String,
    cx: sacp::JrConnectionCx<sacp::link::ClientToAgent>,
    mut command_rx: mpsc::Receiver<AgentCommand>,
    shared: Arc<tokio::sync::Mutex<RuntimeShared>>,
    init_sender: InitSender,
    captured_models: CapturedModels,
    captured_commands: CapturedCommands,
    log_path_string: String,
) -> Result<(), sacp::Error> {
    let init_request = InitializeRequest::new(ProtocolVersion::LATEST);
    let init_response = tokio::time::timeout(
        Duration::from_secs(30),
        cx.send_request(init_request).block_task(),
    )
    .await
    .map_err(|_| sacp::util::internal_error("agent initialization timed out"))??;

    let mut info = to_agent_info(&agent_id, &init_response);
    info.log_file = Some(log_path_string);
    if let Some(init_tx) = init_sender.lock().await.take() {
        let _ = init_tx.send(Ok(info.clone()));
    }

    let mut sessions: HashMap<String, sacp::ActiveSession<'static, sacp::link::ClientToAgent>> =
        HashMap::new();
    let mut active_prompts: HashMap<String, ActivePromptHandle> = HashMap::new();
    let (session_return_tx, mut session_return_rx) = mpsc::channel::<(
        String,
        sacp::ActiveSession<'static, sacp::link::ClientToAgent>,
    )>(16);

    loop {
        tokio::select! {
            maybe_command = command_rx.recv() => {
                let Some(command) = maybe_command else {
                    break;
                };
                match command {
                    AgentCommand::GetInfo { respond_to } => {
                        let _ = respond_to.send(Ok(info.clone()));
                    }
                    AgentCommand::NewSession { cwd, respond_to } => {
                        let session = cx
                            .build_session(PathBuf::from(cwd.clone()))
                            .block_task()
                            .start_session()
                            .await;
                        match session {
                            Ok(session) => {
                                let session_id = session.session_id().0.to_string();
                                // Brief yield to let the I/O task process any notifications
                                // that arrive right after session/new (e.g., available_commands_update)
                                tokio::time::sleep(Duration::from_millis(100)).await;
                                let wire_models = captured_models
                                    .lock()
                                    .ok()
                                    .and_then(|mut guard| guard.take());
                                let wire_commands = captured_commands
                                    .lock()
                                    .ok()
                                    .and_then(|mut guard| guard.take());
                                let session_info =
                                    to_session_info(&session, wire_models, wire_commands);
                                sessions.insert(session_id, session);
                                let _ = respond_to.send(Ok(session_info));
                            }
                            Err(error) => {
                                log::error!("[acp] session/new failed agent_id={agent_id}: {error}");
                                let conn_err = sacp_error_to_connection_error(&error);
                                let _ = respond_to.send(Err(connection_error_to_string(&conn_err)));
                            }
                        }
                    }
                    AgentCommand::Prompt {
                        session_id,
                        text,
                        on_event,
                        respond_to,
                    } => {
                        if active_prompts.contains_key(&session_id) {
                            let _ = respond_to.send(Err("prompt already in progress".to_string()));
                            continue;
                        }
                        if text.trim().is_empty() {
                            let _ = respond_to.send(Err("prompt text cannot be empty".to_string()));
                            continue;
                        }
                        let Some(session) = sessions.remove(&session_id) else {
                            let _ = respond_to.send(Err(format!("session '{session_id}' not found")));
                            continue;
                        };

                        set_active_stream_for_session(
                            &shared,
                            session_id.clone(),
                            on_event.clone(),
                        )
                        .await;
                        active_prompts.insert(
                            session_id.clone(),
                            ActivePromptHandle {
                                session_id: session_id.clone(),
                            },
                        );

                        let task_agent_id = agent_id.clone();
                        let task_session_id = session_id.clone();
                        let task_shared = shared.clone();
                        let task_return_tx = session_return_tx.clone();
                        tauri::async_runtime::spawn(async move {
                            prompt_reader_task(
                                task_agent_id,
                                task_session_id,
                                session,
                                text,
                                on_event,
                                respond_to,
                                task_shared,
                                task_return_tx,
                            )
                            .await;
                        });
                    }
                    AgentCommand::RespondPermission {
                        request_id,
                        option_id,
                        respond_to,
                    } => {
                        let result =
                            resolve_permission_selection(&shared, request_id, Some(option_id)).await;
                        let _ = respond_to.send(result);
                    }
                    AgentCommand::Cancel {
                        session_id,
                        respond_to,
                    } => {
                        let send_result = cx
                            .send_notification(CancelNotification::new(session_id.clone()))
                            .map_err(|error| error.to_string());
                        cancel_pending_permissions_for_session(&shared, &session_id).await;
                        let _ = respond_to.send(send_result);
                    }
                    AgentCommand::SetMode {
                        session_id,
                        mode_id,
                        respond_to,
                    } => {
                        if active_prompts.contains_key(&session_id) {
                            let _ = respond_to.send(Err(
                                "cannot change mode while a prompt is running".to_string()
                            ));
                            continue;
                        }
                        let mode_result = cx
                            .send_request(SetSessionModeRequest::new(
                                session_id.clone(),
                                mode_id.clone(),
                            ))
                            .block_task()
                            .await
                            .map_err(|error| error.to_string())
                            .map(|_| ());
                        let _ = respond_to.send(mode_result);
                    }
                    AgentCommand::SetModel {
                        session_id,
                        model_id,
                        respond_to,
                    } => {
                        if active_prompts.contains_key(&session_id) {
                            let _ = respond_to.send(Err(
                                "cannot change model while a prompt is running".to_string()
                            ));
                            continue;
                        }
                        let model_result = cx
                            .send_request(SetSessionModelRequest {
                                session_id: session_id.clone(),
                                model_id: model_id.clone(),
                            })
                            .block_task()
                            .await
                            .map_err(|error| error.to_string())
                            .map(|_| ());
                        let _ = respond_to.send(model_result);
                    }
                }
            }
            Some((session_id, session)) = session_return_rx.recv() => {
                active_prompts.remove(&session_id);
                sessions.insert(session_id, session);
            }
        }
    }

    cancel_all_pending_permissions(&shared).await;
    Ok(())
}

async fn prompt_reader_task(
    agent_id: String,
    session_id: String,
    mut session: sacp::ActiveSession<'static, sacp::link::ClientToAgent>,
    text: String,
    on_event: Channel<AgentEvent>,
    respond_to: oneshot::Sender<Result<(), String>>,
    shared: Arc<tokio::sync::Mutex<RuntimeShared>>,
    return_tx: mpsc::Sender<(
        String,
        sacp::ActiveSession<'static, sacp::link::ClientToAgent>,
    )>,
) {
    match session.send_prompt(text) {
        Ok(()) => {}
        Err(error) => {
            log::error!(
                "[acp] failed to send prompt agent_id={agent_id} session_id={session_id}: {error}"
            );
            let _ = respond_to.send(Err(format!("failed to send prompt to agent: {error}")));
            clear_active_stream_for_session(&shared, &session_id).await;
            let _ = return_tx.send((session_id, session)).await;
            return;
        }
    }

    let mut tool_calls: HashMap<String, ToolCall> = HashMap::new();
    let mut update_count: usize = 0;
    let mut saw_visible_output = false;
    let mut respond_to = Some(respond_to);

    loop {
        match session.read_update().await {
            Ok(SessionMessage::StopReason(stop_reason)) => {
                let stop_reason_text = stop_reason_to_string(stop_reason);
                if !saw_visible_output {
                    let message = format!(
                        "agent finished with stop reason '{}' but produced no visible output. check ACP logs for upstream provider/model errors.",
                        stop_reason_text
                    );
                    log::warn!("[acp] agent_id={agent_id} session_id={session_id} {message}");
                    let _ = on_event.send(AgentEvent::Error {
                        message: message.clone(),
                    });
                }
                let _ = on_event.send(AgentEvent::Done {
                    stop_reason: stop_reason_text,
                });
                if let Some(tx) = respond_to.take() {
                    let _ = tx.send(Ok(()));
                }
                break;
            }
            Ok(SessionMessage::SessionMessage(message_cx)) => {
                update_count += 1;
                let handled = MatchMessage::new(message_cx)
                    .if_notification(async |notification: SessionNotification| {
                        handle_session_notification_in_reader(
                            &agent_id,
                            &session_id,
                            &on_event,
                            &mut tool_calls,
                            update_count,
                            &mut saw_visible_output,
                            notification,
                        )?;
                        Ok(())
                    })
                    .await
                    .otherwise_ignore();

                if let Err(error) = handled {
                    log::error!(
                        "[acp][{agent_id}][session:{session_id}] failed to process session/update: {error}"
                    );
                    let message = format!("failed to handle session update: {error}");
                    let _ = on_event.send(AgentEvent::Error {
                        message: message.clone(),
                    });
                    if let Some(tx) = respond_to.take() {
                        let _ = tx.send(Err(message));
                    }
                    break;
                }
            }
            Err(error) => {
                log::error!(
                    "[acp][{agent_id}][session:{session_id}] failed while reading prompt updates: {error}"
                );
                let message = format!("failed reading prompt updates: {error}");
                let _ = on_event.send(AgentEvent::Error {
                    message: message.clone(),
                });
                if let Some(tx) = respond_to.take() {
                    let _ = tx.send(Err(message));
                }
                break;
            }
            Ok(_) => {}
        }
    }

    clear_active_stream_for_session(&shared, &session_id).await;
    let _ = return_tx.send((session_id, session)).await;
}

fn handle_session_notification_in_reader(
    _agent_id: &str,
    _session_id: &str,
    on_event: &Channel<AgentEvent>,
    tool_calls: &mut HashMap<String, ToolCall>,
    _update_count: usize,
    saw_visible_output: &mut bool,
    notification: SessionNotification,
) -> Result<(), sacp::Error> {
    match notification.update {
        SessionUpdate::UserMessageChunk(_) => {}
        SessionUpdate::AgentMessageChunk(chunk) => match chunk.content {
            ContentBlock::Text(text_content) => {
                if !text_content.text.is_empty() {
                    *saw_visible_output = true;
                }
                on_event
                    .send(AgentEvent::MessageChunk {
                        text: text_content.text,
                    })
                    .map_err(sacp::util::internal_error)?;
            }
            other => {
                let placeholder = format!(
                    "[unsupported agent message content: {}]",
                    content_block_kind(&other)
                );
                *saw_visible_output = true;
                on_event
                    .send(AgentEvent::MessageChunk { text: placeholder })
                    .map_err(sacp::util::internal_error)?;
            }
        },
        SessionUpdate::AgentThoughtChunk(chunk) => {
            if let ContentBlock::Text(text_content) = chunk.content {
                if !text_content.text.is_empty() {
                    *saw_visible_output = true;
                }
                on_event
                    .send(AgentEvent::ThinkingChunk {
                        text: text_content.text,
                    })
                    .map_err(sacp::util::internal_error)?;
            }
        }
        SessionUpdate::ToolCall(tool_call) => {
            let id = tool_call.tool_call_id.0.to_string();
            tool_calls.insert(id.clone(), tool_call);
            if let Some(current) = tool_calls.get(&id) {
                *saw_visible_output = true;
                on_event
                    .send(tool_call_to_event(current))
                    .map_err(sacp::util::internal_error)?;
            }
        }
        SessionUpdate::ToolCallUpdate(update) => {
            let id = update.tool_call_id.0.to_string();
            let tool_call = tool_calls
                .entry(id.clone())
                .or_insert_with(|| ToolCall::new(update.tool_call_id.clone(), "tool"));
            tool_call.update(update.fields);
            *saw_visible_output = true;
            on_event
                .send(tool_call_to_event(tool_call))
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::Plan(plan) => {
            let entries = plan
                .entries
                .into_iter()
                .map(|entry| PlanEntryInfo {
                    content: entry.content,
                    status: plan_entry_status_to_string(entry.status),
                })
                .collect();
            *saw_visible_output = true;
            on_event
                .send(AgentEvent::PlanUpdate { entries })
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::CurrentModeUpdate(CurrentModeUpdate {
            current_mode_id, ..
        }) => {
            on_event
                .send(AgentEvent::ModeUpdate {
                    current_mode_id: current_mode_id.0.to_string(),
                })
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::AvailableCommandsUpdate(update) => {
            let commands = update
                .available_commands
                .into_iter()
                .map(|command| SlashCommandInfo {
                    name: command.name,
                    description: command.description,
                    input_hint: command.input.and_then(|input| match input {
                        AvailableCommandInput::Unstructured(spec) => Some(spec.hint),
                        _ => None,
                    }),
                })
                .collect();
            on_event
                .send(AgentEvent::CommandsUpdate { commands })
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::ConfigOptionUpdate(_) => {}
        _ => {}
    }

    Ok(())
}

async fn handle_permission_request(
    _agent_id: String,
    shared: Arc<tokio::sync::Mutex<RuntimeShared>>,
    request: RequestPermissionRequest,
    request_cx: sacp::JrRequestCx<RequestPermissionResponse>,
) -> Result<(), sacp::Error> {
    let (decision_tx, decision_rx) = oneshot::channel::<Option<String>>();
    let request_id;
    let mut should_wait = false;
    let request_session_id = request.session_id.0.to_string();

    {
        let mut runtime = shared.lock().await;
        runtime.next_permission_request_id += 1;
        request_id = format!("permission-{}", runtime.next_permission_request_id);

        runtime.pending_permissions.insert(
            request_id.clone(),
            PendingPermission {
                session_id: request_session_id.clone(),
                decision_tx,
            },
        );

        if let Some(stream) = runtime.active_streams.get(&request_session_id) {
            let event = AgentEvent::PermissionRequest {
                request_id: request_id.clone(),
                tool_call_id: request.tool_call.tool_call_id.0.to_string(),
                title: request.tool_call.fields.title.clone(),
                options: request
                    .options
                    .iter()
                    .map(|option| PermissionOptionInfo {
                        option_id: option.option_id.0.to_string(),
                        name: option.name.clone(),
                        kind: permission_option_kind_to_string(option.kind),
                    })
                    .collect(),
            };
            if stream.channel.send(event).is_ok() {
                should_wait = true;
            }
        }
    }

    if !should_wait {
        let mut runtime = shared.lock().await;
        runtime.pending_permissions.remove(&request_id);
        return request_cx.respond(RequestPermissionResponse::new(
            RequestPermissionOutcome::Cancelled,
        ));
    }

    let selected_option = decision_rx.await.ok().flatten();

    {
        let mut runtime = shared.lock().await;
        runtime.pending_permissions.remove(&request_id);
    }

    let response = match selected_option {
        Some(option_id) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option_id),
        )),
        None => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
    };

    request_cx.respond(response)
}

fn content_block_kind(content: &ContentBlock) -> &'static str {
    match content {
        ContentBlock::Text(_) => "text",
        ContentBlock::Image(_) => "image",
        ContentBlock::Audio(_) => "audio",
        ContentBlock::ResourceLink(_) => "resource_link",
        ContentBlock::Resource(_) => "resource",
        _ => "other",
    }
}

fn tool_call_to_event(tool_call: &ToolCall) -> AgentEvent {
    let content = tool_call_content_to_string(&tool_call.content);
    let locations = tool_call_locations_to_strings(&tool_call.locations);
    let diff_data = tool_call_diff_data(&tool_call.content);
    AgentEvent::ToolCallUpdate {
        tool_call_id: tool_call.tool_call_id.0.to_string(),
        title: tool_call.title.clone(),
        kind: tool_kind_to_string(tool_call.kind),
        status: tool_call_status_to_string(tool_call.status),
        content,
        locations,
        diff_data,
    }
}

fn tool_call_diff_data(content: &[ToolCallContent]) -> Option<DiffInfo> {
    for item in content {
        if let ToolCallContent::Diff(diff) = item {
            return Some(DiffInfo {
                path: diff.path.to_string_lossy().to_string(),
                old_text: diff.old_text.clone(),
                new_text: Some(diff.new_text.clone()),
            });
        }
    }
    None
}

fn tool_call_content_to_string(content: &[ToolCallContent]) -> Option<String> {
    let mut lines = Vec::new();
    for item in content {
        match item {
            ToolCallContent::Content(content_item) => {
                if let ContentBlock::Text(text) = &content_item.content {
                    lines.push(text.text.clone());
                }
            }
            ToolCallContent::Diff(diff) => {
                lines.push(format!("diff: {}", diff.path.to_string_lossy()));
            }
            ToolCallContent::Terminal(terminal) => {
                lines.push(format!("terminal: {}", terminal.terminal_id.0));
            }
            _ => {}
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n\n"))
    }
}

fn tool_call_locations_to_strings(locations: &[ToolCallLocation]) -> Option<Vec<String>> {
    if locations.is_empty() {
        return None;
    }
    let converted = locations
        .iter()
        .map(|location| match location.line {
            Some(line) => format!("{}:{}", location.path.to_string_lossy(), line),
            None => location.path.to_string_lossy().to_string(),
        })
        .collect::<Vec<_>>();
    Some(converted)
}

fn to_agent_info(agent_id: &str, response: &sacp::schema::InitializeResponse) -> AgentInfo {
    let auth_methods = response
        .auth_methods
        .iter()
        .map(|method| AuthMethodInfo {
            id: method.id.0.to_string(),
            name: method.name.clone(),
            description: method.description.clone(),
        })
        .collect();
    match response.agent_info.as_ref() {
        Some(info) => AgentInfo {
            agent_id: agent_id.to_string(),
            name: info.title.clone().unwrap_or_else(|| info.name.clone()),
            version: info.version.clone(),
            auth_methods,
            log_file: None,
        },
        None => AgentInfo {
            agent_id: agent_id.to_string(),
            name: "agent".to_string(),
            version: "unknown".to_string(),
            auth_methods,
            log_file: None,
        },
    }
}

fn to_session_info(
    session: &sacp::ActiveSession<'static, sacp::link::ClientToAgent>,
    wire_models: Option<RawSessionModels>,
    wire_commands: Option<Vec<SlashCommandInfo>>,
) -> SessionInfo {
    let (available_modes, current_mode_id) = session
        .modes()
        .as_ref()
        .map(|modes| {
            let parsed_modes = modes
                .available_modes
                .iter()
                .map(|mode| SessionModeInfo {
                    id: mode.id.0.to_string(),
                    name: mode.name.clone(),
                    description: mode.description.clone(),
                })
                .collect::<Vec<_>>();
            let current = Some(modes.current_mode_id.0.to_string());
            (parsed_modes, current)
        })
        .unwrap_or_else(|| (Vec::new(), None));

    let available_commands = wire_commands.unwrap_or_default();

    let (available_models, current_model_id) = match wire_models {
        Some(models) => {
            let parsed = models
                .available_models
                .into_iter()
                .map(|m| ModelInfoData {
                    name: m.name.unwrap_or_else(|| m.model_id.clone()),
                    description: m.description,
                    model_id: m.model_id,
                })
                .collect::<Vec<_>>();
            (parsed, Some(models.current_model_id))
        }
        None => (Vec::new(), None),
    };

    SessionInfo {
        session_id: session.session_id().0.to_string(),
        available_modes,
        current_mode_id,
        available_commands,
        available_models,
        current_model_id,
    }
}

fn build_agent(
    _agent_id: &str,
    command: String,
    env: HashMap<String, String>,
    captured_error: CapturedError,
    process_log: AcpProcessLog,
) -> Result<(AcpAgent, CapturedModels, CapturedCommands), String> {
    let parsed = AcpAgent::from_str(&command)
        .map_err(|error| format!("invalid command '{command}': {error}"))?;
    let mut server = parsed.into_server();
    match &mut server {
        sacp::schema::McpServer::Stdio(stdio) => {
            for (name, value) in env {
                if let Some(existing) = stdio.env.iter_mut().find(|variable| variable.name == name)
                {
                    existing.value = value;
                } else {
                    stdio.env.push(sacp::schema::EnvVariable::new(name, value));
                }
            }
        }
        _ => {
            return Err(
                "only stdio agent commands are currently supported by this client".to_string(),
            );
        }
    }
    let captured_models: CapturedModels = Arc::new(std::sync::Mutex::new(None));
    let captured_models_for_callback = captured_models.clone();
    let captured_commands: CapturedCommands = Arc::new(std::sync::Mutex::new(None));
    let captured_commands_for_callback = captured_commands.clone();
    let captured_error_for_callback = captured_error.clone();
    let agent = AcpAgent::new(server).with_debug(move |line, direction| {
        let direction_str = match direction {
            LineDirection::Stdout => "stdout",
            LineDirection::Stdin => "stdin",
            LineDirection::Stderr => "stderr",
        };
        write_acp_log(&process_log, direction_str, line);
        if matches!(direction, LineDirection::Stdout) {
            if let Ok(rpc) = serde_json::from_str::<RawJsonRpcResponse>(line) {
                if let Some(result) = rpc.result {
                    if let Ok(session_result) =
                        serde_json::from_value::<RawSessionNewResult>(result)
                    {
                        if session_result.session_id.is_some() {
                            if let Some(models) = session_result.models {
                                if let Ok(mut guard) = captured_models_for_callback.lock() {
                                    *guard = Some(models);
                                }
                            }
                        }
                    }
                }
                if let Some(ref error) = rpc.error {
                    if let Ok(mut guard) = captured_error_for_callback.lock() {
                        *guard = Some(error.clone());
                    }
                }
            }
            if line.contains("available_commands_update") {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                    if val.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                        if let Some(commands_val) = val.pointer("/params/update/availableCommands")
                        {
                            if let Ok(raw_commands) =
                                serde_json::from_value::<Vec<RawWireCommand>>(commands_val.clone())
                            {
                                let slash_commands: Vec<SlashCommandInfo> = raw_commands
                                    .into_iter()
                                    .map(|c| {
                                        let input_hint = c.input.and_then(|v| {
                                            v.get("hint")
                                                .and_then(|h| h.as_str().map(|s| s.to_string()))
                                        });
                                        SlashCommandInfo {
                                            name: c.name,
                                            description: c.description,
                                            input_hint,
                                        }
                                    })
                                    .collect();
                                if let Ok(mut guard) = captured_commands_for_callback.lock() {
                                    *guard = Some(slash_commands);
                                }
                            }
                        }
                    }
                }
            }
        }
    });
    Ok((agent, captured_models, captured_commands))
}

async fn resolve_permission_selection(
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    request_id: String,
    selection: Option<String>,
) -> Result<(), String> {
    let pending = {
        let mut runtime = shared.lock().await;
        runtime.pending_permissions.remove(&request_id)
    };

    let Some(pending) = pending else {
        return Err(format!("permission request '{request_id}' not found"));
    };

    pending
        .decision_tx
        .send(selection)
        .map_err(|_| format!("permission request '{request_id}' is no longer waiting"))
}

async fn cancel_pending_permissions_for_session(
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    session_id: &str,
) {
    let to_cancel = {
        let mut runtime = shared.lock().await;
        let ids: Vec<String> = runtime
            .pending_permissions
            .iter()
            .filter(|(_, p)| p.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        let mut senders = Vec::new();
        for id in ids {
            if let Some(p) = runtime.pending_permissions.remove(&id) {
                senders.push(p.decision_tx);
            }
        }
        senders
    };
    for sender in to_cancel {
        let _ = sender.send(None);
    }
}

async fn cancel_all_pending_permissions(shared: &Arc<tokio::sync::Mutex<RuntimeShared>>) {
    let pending = {
        let mut runtime = shared.lock().await;
        runtime
            .pending_permissions
            .drain()
            .map(|(_, p)| p.decision_tx)
            .collect::<Vec<_>>()
    };
    for sender in pending {
        let _ = sender.send(None);
    }
}

async fn set_active_stream_for_session(
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    session_id: String,
    channel: Channel<AgentEvent>,
) {
    let mut runtime = shared.lock().await;
    runtime.active_streams.insert(
        session_id.clone(),
        ActiveStream {
            session_id,
            channel,
        },
    );
}

async fn clear_active_stream_for_session(
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    session_id: &str,
) {
    let mut runtime = shared.lock().await;
    runtime.active_streams.remove(session_id);
}

async fn remove_agent_handle_from_app_state(app_handle: &AppHandle, agent_id: &str) {
    if let Some(state) = app_handle.try_state::<AcpState>() {
        let mut inner = state.0.lock().await;
        inner.agents.remove(agent_id);
    }
}

async fn set_agent_log_file(app_handle: &AppHandle, agent_id: &str, log_file: PathBuf) {
    if let Some(state) = app_handle.try_state::<AcpState>() {
        let mut inner = state.0.lock().await;
        if let Some(handle) = inner.agents.get_mut(agent_id) {
            handle.log_file = Some(log_file);
        }
    }
}

fn emit_agent_crashed(app_handle: &AppHandle, agent_id: &str, message: &str) {
    emit_agent_crashed_with_kind(app_handle, agent_id, "crashed", message);
}

fn emit_agent_crashed_with_kind(app_handle: &AppHandle, agent_id: &str, kind: &str, message: &str) {
    log::error!("[acp][{agent_id}] agent crashed kind={kind}: {message}");
    let payload = AgentCrashPayload {
        agent_id: agent_id.to_string(),
        kind: kind.to_string(),
        message: message.to_string(),
    };
    let _ = app_handle.emit("acp-agent-crashed", payload);
}

fn stop_reason_to_string(stop_reason: StopReason) -> String {
    match stop_reason {
        StopReason::EndTurn => "end_turn".to_string(),
        StopReason::MaxTokens => "max_tokens".to_string(),
        StopReason::MaxTurnRequests => "max_turn_requests".to_string(),
        StopReason::Refusal => "refusal".to_string(),
        StopReason::Cancelled => "cancelled".to_string(),
        _ => "unknown".to_string(),
    }
}

fn plan_entry_status_to_string(status: PlanEntryStatus) -> String {
    match status {
        PlanEntryStatus::Pending => "pending".to_string(),
        PlanEntryStatus::InProgress => "in_progress".to_string(),
        PlanEntryStatus::Completed => "completed".to_string(),
        _ => "pending".to_string(),
    }
}

fn tool_kind_to_string(kind: ToolKind) -> String {
    match kind {
        ToolKind::Read => "read".to_string(),
        ToolKind::Edit => "edit".to_string(),
        ToolKind::Delete => "delete".to_string(),
        ToolKind::Move => "move".to_string(),
        ToolKind::Search => "search".to_string(),
        ToolKind::Execute => "execute".to_string(),
        ToolKind::Think => "think".to_string(),
        ToolKind::Fetch => "fetch".to_string(),
        ToolKind::SwitchMode => "switch_mode".to_string(),
        ToolKind::Other => "other".to_string(),
        _ => "other".to_string(),
    }
}

fn tool_call_status_to_string(status: ToolCallStatus) -> String {
    match status {
        ToolCallStatus::Pending => "pending".to_string(),
        ToolCallStatus::InProgress => "in_progress".to_string(),
        ToolCallStatus::Completed => "completed".to_string(),
        ToolCallStatus::Failed => "failed".to_string(),
        _ => "pending".to_string(),
    }
}

fn permission_option_kind_to_string(kind: PermissionOptionKind) -> String {
    match kind {
        PermissionOptionKind::AllowOnce => "allow_once".to_string(),
        PermissionOptionKind::AllowAlways => "allow_always".to_string(),
        PermissionOptionKind::RejectOnce => "reject_once".to_string(),
        PermissionOptionKind::RejectAlways => "reject_always".to_string(),
        _ => "allow_once".to_string(),
    }
}

fn sacp_error_to_connection_error(error: &sacp::Error) -> AcpConnectionError {
    use sacp::schema::ErrorCode;
    let kind = match error.code {
        ErrorCode::AuthRequired => "auth_required",
        ErrorCode::InternalError => "internal",
        _ => "unknown",
    };
    let message = clean_sacp_error_message(&error.to_string());
    AcpConnectionError {
        kind: kind.to_string(),
        message,
    }
}

fn connection_error_to_string(error: &AcpConnectionError) -> String {
    serde_json::to_string(error).unwrap_or_else(|_| error.message.clone())
}

/// Types for wire-level capture of models from session/new response.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSessionNewResult {
    session_id: Option<String>,
    #[serde(default)]
    models: Option<RawSessionModels>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSessionModels {
    current_model_id: String,
    available_models: Vec<RawModelInfo>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawModelInfo {
    model_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize)]
struct RawJsonRpcResponse {
    result: Option<serde_json::Value>,
    error: Option<RawJsonRpcError>,
}

#[derive(Clone, Deserialize)]
struct RawJsonRpcError {
    code: i32,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

/// Extract a human-readable error detail from a wire error.
/// Prefers `data.details`, falls back to `data` as string, then `message`.
fn extract_wire_error_detail(error: &RawJsonRpcError) -> String {
    if let Some(data) = &error.data {
        if let Some(details) = data.get("details").and_then(|v| v.as_str()) {
            return details.to_string();
        }
        if let Some(s) = data.as_str() {
            // Take just the first meaningful line, not long traces
            return s.lines().next().unwrap_or(s).to_string();
        }
    }
    error.message.clone()
}

/// Clean up sacp error strings that contain embedded JSON.
/// Format is usually: "Error type: { \"data\": \"...\", \"spawned_at\": \"...\" }"
fn clean_sacp_error_message(raw: &str) -> String {
    if let Some(idx) = raw.find(": {") {
        let prefix = raw[..idx].trim();
        let json_part = raw[idx + 2..].trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_part) {
            if let Some(details) = val
                .get("data")
                .and_then(|d| d.get("details"))
                .and_then(|d| d.as_str())
            {
                return details.to_string();
            }
            if let Some(data_str) = val.get("data").and_then(|d| d.as_str()) {
                return data_str.lines().next().unwrap_or(data_str).to_string();
            }
        }
        if !prefix.is_empty() {
            return prefix.to_string();
        }
    }
    raw.to_string()
}

type CapturedModels = Arc<std::sync::Mutex<Option<RawSessionModels>>>;
type CapturedError = Arc<std::sync::Mutex<Option<RawJsonRpcError>>>;
type CapturedCommands = Arc<std::sync::Mutex<Option<Vec<SlashCommandInfo>>>>;

/// Wire-level command data from session/update notifications.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawWireCommand {
    name: String,
    description: String,
    #[serde(default)]
    input: Option<serde_json::Value>,
}

/// Custom request type for session/set_model since the sacp crate
/// doesn't expose it without the unstable_session_model feature flag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSessionModelRequest {
    session_id: String,
    model_id: String,
}

impl sacp::JrMessage for SetSessionModelRequest {
    fn method(&self) -> &str {
        "session/set_model"
    }

    fn to_untyped_message(&self) -> Result<sacp::UntypedMessage, sacp::Error> {
        sacp::UntypedMessage::new(self.method(), self)
    }

    fn parse_message(method: &str, params: &impl Serialize) -> Option<Result<Self, sacp::Error>> {
        if method != "session/set_model" {
            return None;
        }
        let value = serde_json::to_value(params).ok()?;
        Some(serde_json::from_value(value).map_err(sacp::Error::into_internal_error))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SetSessionModelResponse {}

impl sacp::JrRequest for SetSessionModelRequest {
    type Response = SetSessionModelResponse;
}

impl sacp::JrResponsePayload for SetSessionModelResponse {
    fn into_json(self, _method: &str) -> Result<serde_json::Value, sacp::Error> {
        serde_json::to_value(self).map_err(sacp::Error::into_internal_error)
    }

    fn from_value(_method: &str, value: serde_json::Value) -> Result<Self, sacp::Error> {
        serde_json::from_value(value).map_err(sacp::Error::into_internal_error)
    }
}
