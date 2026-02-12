use std::{collections::HashMap, path::PathBuf, str::FromStr, sync::Arc, time::Duration};

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
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot};

pub struct AcpState(pub(crate) tokio::sync::Mutex<AcpStateInner>);

#[derive(Default)]
pub(crate) struct AcpStateInner {
    /// One entry per running agent process, keyed by caller-provided agent_id.
    agents: HashMap<String, AgentHandle>,
}

struct AgentHandle {
    /// Send commands into the background run_until task.
    command_tx: mpsc::Sender<AgentCommand>,
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
    pub name: String,
    pub version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub available_modes: Vec<SessionModeInfo>,
    pub available_commands: Vec<SlashCommandInfo>,
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
    },
    #[serde(rename_all = "camelCase")]
    PermissionRequest {
        request_id: String,
        tool_call_id: String,
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
}

struct ActivePrompt {
    agent_id: String,
    session_id: String,
    on_event: Channel<AgentEvent>,
    respond_to: Option<oneshot::Sender<Result<(), String>>>,
    tool_calls: HashMap<String, ToolCall>,
    update_count: usize,
    saw_visible_output: bool,
}

#[derive(Default)]
struct RuntimeShared {
    active_stream: Option<ActiveStream>,
    pending_permissions: HashMap<String, oneshot::Sender<Option<String>>>,
    next_permission_request_id: u64,
}

#[derive(Clone)]
struct ActiveStream {
    session_id: String,
    channel: Channel<AgentEvent>,
}

type InitSender = Arc<tokio::sync::Mutex<Option<oneshot::Sender<Result<AgentInfo, String>>>>>;

const ACP_PROMPT_PREVIEW_CHARS: usize = 220;
const ACP_LOG_MAX_CHARS: usize = 4000;

#[tauri::command]
pub async fn acp_connect(
    app_handle: AppHandle,
    state: State<'_, AcpState>,
    agent_id: String,
    command: String,
    env: HashMap<String, String>,
) -> Result<AgentInfo, String> {
    log::info!(
        "[acp][{agent_id}] connect requested command='{}' env={}",
        command,
        to_json_log(&redact_env_for_logging(&env))
    );
    if let Some(existing_tx) = {
        let inner = state.0.lock().await;
        inner
            .agents
            .get(&agent_id)
            .map(|handle| handle.command_tx.clone())
    } {
        log::info!("[acp][{agent_id}] reusing existing connection");
        let info_result = request_agent_info(existing_tx).await;
        match &info_result {
            Ok(info) => log::info!(
                "[acp][{agent_id}] connect reused existing agent info={}",
                to_json_log(info)
            ),
            Err(error) => {
                log::warn!("[acp][{agent_id}] failed to query existing agent info: {error}")
            }
        }
        return info_result;
    }

    let (command_tx, command_rx) = mpsc::channel(64);
    let (init_tx, init_rx) = oneshot::channel();

    {
        let mut inner = state.0.lock().await;
        inner.agents.insert(
            agent_id.clone(),
            AgentHandle {
                command_tx: command_tx.clone(),
            },
        );
    }

    let spawned_agent_id = agent_id.clone();
    let spawned_app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        run_agent_task(
            spawned_app_handle,
            spawned_agent_id,
            command,
            env,
            command_rx,
            init_tx,
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
            "[acp][{agent_id}] connect completed info={}",
            to_json_log(info)
        ),
        Err(error) => log::error!("[acp][{agent_id}] connect failed: {error}"),
    }

    connect_result
}

#[tauri::command]
pub async fn acp_new_session(
    state: State<'_, AcpState>,
    agent_id: String,
    cwd: String,
) -> Result<SessionInfo, String> {
    log::info!(
        "[acp][{agent_id}] -> client new_session {}",
        to_json_log(&serde_json::json!({ "cwd": cwd.clone() }))
    );
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
    command_tx
        .send(AgentCommand::NewSession { cwd, respond_to })
        .await
        .map_err(|_| format!("agent '{agent_id}' is not running"))?;
    let result = response_rx
        .await
        .map_err(|_| format!("agent '{agent_id}' did not respond"))?;

    match &result {
        Ok(session) => log::info!(
            "[acp][{agent_id}] <- client new_session {}",
            to_json_log(session)
        ),
        Err(error) => log::warn!("[acp][{agent_id}] <- client new_session error: {error}"),
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
    let prompt_preview = summarize_text_for_log(&text, ACP_PROMPT_PREVIEW_CHARS);
    let prompt_len = text.chars().count();
    log::info!(
        "[acp][{agent_id}] -> client prompt session_id={session_id} chars={prompt_len} preview={prompt_preview}"
    );
    let command_tx = get_agent_command_tx(&state, &agent_id).await?;
    let (respond_to, response_rx) = oneshot::channel();
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
        Ok(()) => log::info!("[acp][{agent_id}] <- client prompt completed"),
        Err(error) => log::warn!("[acp][{agent_id}] <- client prompt error: {error}"),
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
        "[acp][{agent_id}] -> client respond_permission request_id={request_id} option_id={option_id}"
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
        Ok(()) => log::info!("[acp][{agent_id}] <- client respond_permission completed"),
        Err(error) => log::warn!("[acp][{agent_id}] <- client respond_permission error: {error}"),
    }

    result
}

#[tauri::command]
pub async fn acp_cancel(
    state: State<'_, AcpState>,
    agent_id: String,
    session_id: String,
) -> Result<(), String> {
    log::info!("[acp][{agent_id}] -> client cancel session_id={session_id}");
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
        Ok(()) => log::info!("[acp][{agent_id}] <- client cancel completed"),
        Err(error) => log::warn!("[acp][{agent_id}] <- client cancel error: {error}"),
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
    log::info!("[acp][{agent_id}] -> client set_mode session_id={session_id} mode_id={mode_id}");
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
        Ok(()) => log::info!("[acp][{agent_id}] <- client set_mode completed"),
        Err(error) => log::warn!("[acp][{agent_id}] <- client set_mode error: {error}"),
    }

    result
}

async fn get_agent_command_tx(
    state: &State<'_, AcpState>,
    agent_id: &str,
) -> Result<mpsc::Sender<AgentCommand>, String> {
    let inner = state.0.lock().await;
    inner
        .agents
        .get(agent_id)
        .map(|handle| handle.command_tx.clone())
        .ok_or_else(|| format!("agent '{agent_id}' is not connected"))
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
) {
    let init_sender = Arc::new(tokio::sync::Mutex::new(Some(init_tx)));
    let shared = Arc::new(tokio::sync::Mutex::new(RuntimeShared::default()));
    log::info!(
        "[acp][{agent_id}] starting background task command='{}' env={}",
        command,
        to_json_log(&redact_env_for_logging(&env))
    );

    let acp_agent = match build_agent(&agent_id, command, env) {
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
        Ok(connection) => {
            log::info!("[acp][{agent_id}] ACP connection established");
            connection
                .run_until({
                    let shared = shared.clone();
                    let init_sender = init_sender.clone();
                    move |cx| {
                        run_agent_command_loop(loop_agent_id, cx, command_rx, shared, init_sender)
                    }
                })
                .await
                .map_err(|error| error.to_string())
        }
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
        log::error!("[acp][{agent_id}] background task failed: {message}");
        emit_agent_crashed(&app_handle, &agent_id, &message);
    } else {
        log::info!("[acp][{agent_id}] background task ended cleanly");
    }
}

async fn run_agent_command_loop(
    agent_id: String,
    cx: sacp::JrConnectionCx<sacp::link::ClientToAgent>,
    mut command_rx: mpsc::Receiver<AgentCommand>,
    shared: Arc<tokio::sync::Mutex<RuntimeShared>>,
    init_sender: InitSender,
) -> Result<(), sacp::Error> {
    log::info!(
        "[acp][{agent_id}] -> initialize protocol={:?}",
        ProtocolVersion::LATEST
    );
    let init_request = InitializeRequest::new(ProtocolVersion::LATEST);
    let init_response = tokio::time::timeout(
        Duration::from_secs(30),
        cx.send_request(init_request).block_task(),
    )
    .await
    .map_err(|_| sacp::util::internal_error("agent initialization timed out"))??;
    log::info!(
        "[acp][{agent_id}] <- initialize {}",
        to_json_log(&init_response)
    );

    let info = to_agent_info(&init_response);
    log::info!(
        "[acp][{agent_id}] resolved agent info={}",
        to_json_log(&info)
    );
    if let Some(init_tx) = init_sender.lock().await.take() {
        let _ = init_tx.send(Ok(info.clone()));
    }

    let mut sessions: HashMap<String, sacp::ActiveSession<'static, sacp::link::ClientToAgent>> =
        HashMap::new();
    let mut active_prompt: Option<ActivePrompt> = None;

    loop {
        if let Some(prompt) = active_prompt.as_mut() {
            let Some(session) = sessions.get_mut(&prompt.session_id) else {
                let message = format!("session '{}' not found", prompt.session_id);
                log::error!(
                    "[acp][{}][session:{}] prompt session missing while streaming",
                    prompt.agent_id,
                    prompt.session_id
                );
                let _ = prompt
                    .on_event
                    .send(AgentEvent::Error {
                        message: message.clone(),
                    })
                    .map_err(|e| log::warn!("failed to stream error event: {e}"));
                complete_prompt(prompt, Err(message));
                clear_active_stream(&shared).await;
                active_prompt = None;
                continue;
            };

            tokio::select! {
                maybe_command = command_rx.recv() => {
                    let Some(command) = maybe_command else {
                        log::info!("[acp][{}] command channel closed while prompt was active", prompt.agent_id);
                        break;
                    };
                    handle_command_while_prompt_running(&cx, &shared, prompt, &info, command).await;
                }
                update = session.read_update() => {
                    match update {
                        Ok(SessionMessage::SessionMessage(message_cx)) => {
                            let handled = MatchMessage::new(message_cx)
                                .if_notification(async |notification: SessionNotification| {
                                    handle_session_notification(prompt, notification)?;
                                    Ok(())
                                })
                                .await
                                .otherwise_ignore();

                            if let Err(error) = handled {
                                log::error!(
                                    "[acp][{}][session:{}] failed to process session/update: {error}",
                                    prompt.agent_id,
                                    prompt.session_id
                                );
                                let message = format!("failed to handle session update: {error}");
                                let _ = prompt.on_event.send(AgentEvent::Error {
                                    message: message.clone(),
                                });
                                complete_prompt(prompt, Err(message));
                                clear_active_stream(&shared).await;
                                active_prompt = None;
                            }
                        }
                        Ok(SessionMessage::StopReason(stop_reason)) => {
                            let stop_reason_text = stop_reason_to_string(stop_reason);
                            log::info!(
                                "[acp][{}][session:{}] <- session/prompt stop_reason={} updates={} visible_output={}",
                                prompt.agent_id,
                                prompt.session_id,
                                stop_reason_text,
                                prompt.update_count,
                                prompt.saw_visible_output
                            );
                            if !prompt.saw_visible_output {
                                let message = format!(
                                    "agent finished with stop reason '{}' but produced no visible output. check ACP logs for upstream provider/model errors.",
                                    stop_reason_text
                                );
                                log::warn!(
                                    "[acp][{}][session:{}] {}",
                                    prompt.agent_id,
                                    prompt.session_id,
                                    message
                                );
                                let _ = prompt.on_event.send(AgentEvent::Error {
                                    message: message.clone(),
                                });
                            }
                            let _ = prompt.on_event.send(AgentEvent::Done {
                                stop_reason: stop_reason_text,
                            });
                            complete_prompt(prompt, Ok(()));
                            clear_active_stream(&shared).await;
                            active_prompt = None;
                        }
                        Err(error) => {
                            log::error!(
                                "[acp][{}][session:{}] failed while reading prompt updates: {error}",
                                prompt.agent_id,
                                prompt.session_id
                            );
                            let message = format!("failed reading prompt updates: {error}");
                            let _ = prompt.on_event.send(AgentEvent::Error {
                                message: message.clone(),
                            });
                            complete_prompt(prompt, Err(message));
                            clear_active_stream(&shared).await;
                            active_prompt = None;
                        }
                        Ok(_) => {}
                    }
                }
            }
        } else {
            let Some(command) = command_rx.recv().await else {
                log::info!("[acp][{agent_id}] command channel closed, shutting down loop");
                break;
            };
            match command {
                AgentCommand::GetInfo { respond_to } => {
                    log::info!("[acp][{agent_id}] -> get_info");
                    let _ = respond_to.send(Ok(info.clone()));
                    log::info!("[acp][{agent_id}] <- get_info {}", to_json_log(&info));
                }
                AgentCommand::NewSession { cwd, respond_to } => {
                    log::info!(
                        "[acp][{agent_id}] -> session/new {}",
                        to_json_log(&serde_json::json!({ "cwd": cwd.clone() }))
                    );
                    let session = cx
                        .build_session(PathBuf::from(cwd.clone()))
                        .block_task()
                        .start_session()
                        .await
                        .map_err(|e| e.to_string());
                    match session {
                        Ok(session) => {
                            let session_id = session.session_id().0.to_string();
                            let session_info = to_session_info(&session);
                            sessions.insert(session_id, session);
                            log::info!(
                                "[acp][{agent_id}] <- session/new {}",
                                to_json_log(&session_info)
                            );
                            let _ = respond_to.send(Ok(session_info));
                        }
                        Err(error) => {
                            log::error!("[acp][{agent_id}] <- session/new error: {error}");
                            let _ = respond_to.send(Err(error));
                        }
                    }
                }
                AgentCommand::Prompt {
                    session_id,
                    text,
                    on_event,
                    respond_to,
                } => {
                    if text.trim().is_empty() {
                        log::warn!("[acp][{agent_id}][session:{session_id}] rejected empty prompt");
                        let _ = respond_to.send(Err("prompt text cannot be empty".to_string()));
                        continue;
                    }
                    let Some(session) = sessions.get_mut(&session_id) else {
                        log::error!(
                            "[acp][{agent_id}] prompt requested unknown session_id={session_id}"
                        );
                        let _ = respond_to.send(Err(format!("session '{session_id}' not found")));
                        continue;
                    };
                    let preview = summarize_text_for_log(&text, ACP_PROMPT_PREVIEW_CHARS);
                    let chars = text.chars().count();
                    log::info!(
                        "[acp][{agent_id}][session:{session_id}] -> session/prompt chars={chars} preview={preview}"
                    );
                    match session.send_prompt(text) {
                        Ok(()) => {
                            log::info!(
                                "[acp][{agent_id}][session:{session_id}] session/prompt accepted"
                            );
                            set_active_stream(
                                &shared,
                                ActiveStream {
                                    session_id: session_id.clone(),
                                    channel: on_event.clone(),
                                },
                            )
                            .await;
                            active_prompt = Some(ActivePrompt {
                                agent_id: agent_id.clone(),
                                session_id,
                                on_event,
                                respond_to: Some(respond_to),
                                tool_calls: HashMap::new(),
                                update_count: 0,
                                saw_visible_output: false,
                            });
                        }
                        Err(error) => {
                            log::error!(
                                "[acp][{agent_id}][session:{session_id}] failed to send prompt: {error}"
                            );
                            let _ = respond_to
                                .send(Err(format!("failed to send prompt to agent: {error}")));
                        }
                    }
                }
                AgentCommand::RespondPermission {
                    request_id,
                    option_id,
                    respond_to,
                } => {
                    log::info!(
                        "[acp][{agent_id}] -> permission/respond request_id={request_id} option_id={option_id}"
                    );
                    let result =
                        resolve_permission_selection(&shared, request_id, Some(option_id)).await;
                    match &result {
                        Ok(()) => log::info!("[acp][{agent_id}] <- permission/respond completed"),
                        Err(error) => {
                            log::warn!("[acp][{agent_id}] <- permission/respond error: {error}")
                        }
                    }
                    let _ = respond_to.send(result);
                }
                AgentCommand::Cancel {
                    session_id,
                    respond_to,
                } => {
                    log::info!("[acp][{agent_id}][session:{session_id}] -> session/cancel");
                    let send_result = cx
                        .send_notification(CancelNotification::new(session_id.clone()))
                        .map_err(|error| error.to_string());
                    cancel_pending_permissions(&shared).await;
                    match &send_result {
                        Ok(()) => {
                            log::info!("[acp][{agent_id}][session:{session_id}] <- session/cancel ok")
                        }
                        Err(error) => log::warn!(
                            "[acp][{agent_id}][session:{session_id}] <- session/cancel error: {error}"
                        ),
                    }
                    let _ = respond_to.send(send_result);
                }
                AgentCommand::SetMode {
                    session_id,
                    mode_id,
                    respond_to,
                } => {
                    log::info!(
                        "[acp][{agent_id}][session:{session_id}] -> session/set_mode mode_id={mode_id}"
                    );
                    let mode_result = cx
                        .send_request(SetSessionModeRequest::new(
                            session_id.clone(),
                            mode_id.clone(),
                        ))
                        .block_task()
                        .await
                        .map_err(|error| error.to_string())
                        .map(|_| ());
                    match &mode_result {
                        Ok(()) => log::info!(
                            "[acp][{agent_id}][session:{session_id}] <- session/set_mode mode_id={mode_id} ok"
                        ),
                        Err(error) => log::warn!(
                            "[acp][{agent_id}][session:{session_id}] <- session/set_mode mode_id={mode_id} error: {error}"
                        ),
                    }
                    let _ = respond_to.send(mode_result);
                }
            }
        }
    }

    cancel_pending_permissions(&shared).await;
    log::info!("[acp][{agent_id}] command loop finished");
    Ok(())
}

fn complete_prompt(prompt: &mut ActivePrompt, result: Result<(), String>) {
    if let Some(respond_to) = prompt.respond_to.take() {
        let _ = respond_to.send(result);
    }
}

async fn handle_command_while_prompt_running(
    cx: &sacp::JrConnectionCx<sacp::link::ClientToAgent>,
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    prompt: &mut ActivePrompt,
    info: &AgentInfo,
    command: AgentCommand,
) {
    match command {
        AgentCommand::RespondPermission {
            request_id,
            option_id,
            respond_to,
        } => {
            log::info!(
                "[acp][{}][session:{}] -> permission/respond while prompt running request_id={request_id} option_id={option_id}",
                prompt.agent_id,
                prompt.session_id
            );
            let result = resolve_permission_selection(shared, request_id, Some(option_id)).await;
            match &result {
                Ok(()) => log::info!(
                    "[acp][{}][session:{}] <- permission/respond while prompt running completed",
                    prompt.agent_id,
                    prompt.session_id
                ),
                Err(error) => log::warn!(
                    "[acp][{}][session:{}] <- permission/respond while prompt running error: {error}",
                    prompt.agent_id,
                    prompt.session_id
                ),
            }
            let _ = respond_to.send(result);
        }
        AgentCommand::Cancel {
            session_id,
            respond_to,
        } => {
            if session_id != prompt.session_id {
                log::warn!(
                    "[acp][{}][session:{}] reject cancel for different session={session_id}",
                    prompt.agent_id,
                    prompt.session_id
                );
                let _ = respond_to.send(Err(format!(
                    "cannot cancel session '{session_id}' while session '{}' is running",
                    prompt.session_id
                )));
                return;
            }
            log::info!(
                "[acp][{}][session:{}] -> session/cancel while prompt running",
                prompt.agent_id,
                prompt.session_id
            );
            let result = cx
                .send_notification(CancelNotification::new(session_id))
                .map_err(|error| error.to_string());
            cancel_pending_permissions(shared).await;
            match &result {
                Ok(()) => log::info!(
                    "[acp][{}][session:{}] <- session/cancel while prompt running ok",
                    prompt.agent_id,
                    prompt.session_id
                ),
                Err(error) => log::warn!(
                    "[acp][{}][session:{}] <- session/cancel while prompt running error: {error}",
                    prompt.agent_id,
                    prompt.session_id
                ),
            }
            let _ = respond_to.send(result);
        }
        AgentCommand::GetInfo { respond_to } => {
            log::info!(
                "[acp][{}][session:{}] -> get_info while prompt running",
                prompt.agent_id,
                prompt.session_id
            );
            let _ = respond_to.send(Ok(info.clone()));
        }
        AgentCommand::NewSession { respond_to, .. } => {
            log::warn!(
                "[acp][{}][session:{}] reject session/new while prompt running",
                prompt.agent_id,
                prompt.session_id
            );
            let _ = respond_to.send(Err(
                "cannot create a new session while a prompt is running".to_string()
            ));
        }
        AgentCommand::Prompt { respond_to, .. } => {
            log::warn!(
                "[acp][{}][session:{}] reject nested prompt while prompt running",
                prompt.agent_id,
                prompt.session_id
            );
            let _ = respond_to.send(Err("prompt already in progress".to_string()));
        }
        AgentCommand::SetMode { respond_to, .. } => {
            log::warn!(
                "[acp][{}][session:{}] reject mode change while prompt running",
                prompt.agent_id,
                prompt.session_id
            );
            let _ = respond_to.send(Err(
                "cannot change mode while a prompt is running".to_string()
            ));
        }
    }
}

async fn handle_permission_request(
    agent_id: String,
    shared: Arc<tokio::sync::Mutex<RuntimeShared>>,
    request: RequestPermissionRequest,
    request_cx: sacp::JrRequestCx<RequestPermissionResponse>,
) -> Result<(), sacp::Error> {
    log::info!(
        "[acp][{agent_id}][session:{}] <- session/request_permission {}",
        request.session_id.0,
        to_json_log(&request)
    );
    let (decision_tx, decision_rx) = oneshot::channel::<Option<String>>();
    let request_id;
    let mut should_wait = false;

    {
        let mut runtime = shared.lock().await;
        runtime.next_permission_request_id += 1;
        request_id = format!("permission-{}", runtime.next_permission_request_id);

        runtime
            .pending_permissions
            .insert(request_id.clone(), decision_tx);

        if let Some(stream) = runtime.active_stream.as_ref() {
            if stream.session_id == request.session_id.0.as_ref() {
                let event = AgentEvent::PermissionRequest {
                    request_id: request_id.clone(),
                    tool_call_id: request.tool_call.tool_call_id.0.to_string(),
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
    }

    if !should_wait {
        log::warn!(
            "[acp][{agent_id}][session:{}] permission request {} cancelled: no active prompt listener",
            request.session_id.0,
            request_id
        );
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

    log::info!(
        "[acp][{agent_id}][session:{}] -> permission decision request_id={} selected_option={}",
        request.session_id.0,
        request_id,
        selected_option.as_deref().unwrap_or("<cancelled>")
    );

    let response = match selected_option {
        Some(option_id) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(option_id),
        )),
        None => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
    };

    log::info!(
        "[acp][{agent_id}][session:{}] <- permission response {}",
        request.session_id.0,
        to_json_log(&response)
    );
    request_cx.respond(response)
}

fn handle_session_notification(
    prompt: &mut ActivePrompt,
    notification: SessionNotification,
) -> Result<(), sacp::Error> {
    prompt.update_count += 1;
    let update_summary = describe_session_update(&notification.update);
    log::info!(
        "[acp][{}][session:{}] <- session/update #{} {} payload={}",
        prompt.agent_id,
        prompt.session_id,
        prompt.update_count,
        update_summary,
        to_json_log(&notification)
    );
    match notification.update {
        SessionUpdate::UserMessageChunk(chunk) => {
            log::info!(
                "[acp][{}][session:{}] ignoring user_message_chunk content_type={}",
                prompt.agent_id,
                prompt.session_id,
                content_block_kind(&chunk.content)
            );
        }
        SessionUpdate::AgentMessageChunk(chunk) => match chunk.content {
            ContentBlock::Text(text_content) => {
                if !text_content.text.is_empty() {
                    prompt.saw_visible_output = true;
                }
                prompt
                    .on_event
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
                prompt.saw_visible_output = true;
                prompt
                    .on_event
                    .send(AgentEvent::MessageChunk { text: placeholder })
                    .map_err(sacp::util::internal_error)?;
                log::warn!(
                    "[acp][{}][session:{}] surfaced unsupported content block type={}",
                    prompt.agent_id,
                    prompt.session_id,
                    content_block_kind(&other)
                );
            }
        },
        SessionUpdate::AgentThoughtChunk(chunk) => {
            if let ContentBlock::Text(text_content) = chunk.content {
                if !text_content.text.is_empty() {
                    prompt.saw_visible_output = true;
                }
                prompt
                    .on_event
                    .send(AgentEvent::ThinkingChunk {
                        text: text_content.text,
                    })
                    .map_err(sacp::util::internal_error)?;
            } else {
                log::info!(
                    "[acp][{}][session:{}] ignoring non-text thought chunk",
                    prompt.agent_id,
                    prompt.session_id
                );
            }
        }
        SessionUpdate::ToolCall(tool_call) => {
            let id = tool_call.tool_call_id.0.to_string();
            prompt.tool_calls.insert(id.clone(), tool_call);
            if let Some(current) = prompt.tool_calls.get(&id) {
                prompt.saw_visible_output = true;
                prompt
                    .on_event
                    .send(tool_call_to_event(current))
                    .map_err(sacp::util::internal_error)?;
            }
        }
        SessionUpdate::ToolCallUpdate(update) => {
            let id = update.tool_call_id.0.to_string();
            let tool_call = prompt
                .tool_calls
                .entry(id.clone())
                .or_insert_with(|| ToolCall::new(update.tool_call_id.clone(), "tool"));
            tool_call.update(update.fields);
            prompt.saw_visible_output = true;
            prompt
                .on_event
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
            prompt.saw_visible_output = true;
            prompt
                .on_event
                .send(AgentEvent::PlanUpdate { entries })
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::CurrentModeUpdate(CurrentModeUpdate {
            current_mode_id, ..
        }) => {
            prompt
                .on_event
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
            prompt
                .on_event
                .send(AgentEvent::CommandsUpdate { commands })
                .map_err(sacp::util::internal_error)?;
        }
        SessionUpdate::ConfigOptionUpdate(update) => {
            log::info!(
                "[acp][{}][session:{}] received config option update count={}",
                prompt.agent_id,
                prompt.session_id,
                update.config_options.len()
            );
        }
        _ => {
            log::info!(
                "[acp][{}][session:{}] unhandled session update variant: {}",
                prompt.agent_id,
                prompt.session_id,
                update_summary
            );
        }
    }

    Ok(())
}

fn describe_session_update(update: &SessionUpdate) -> String {
    match update {
        SessionUpdate::UserMessageChunk(chunk) => {
            format!(
                "user_message_chunk content_type={}",
                content_block_kind(&chunk.content)
            )
        }
        SessionUpdate::AgentMessageChunk(chunk) => {
            format!(
                "agent_message_chunk content_type={}",
                content_block_kind(&chunk.content)
            )
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            format!(
                "agent_thought_chunk content_type={}",
                content_block_kind(&chunk.content)
            )
        }
        SessionUpdate::ToolCall(tool_call) => format!(
            "tool_call id={} title={} status={}",
            tool_call.tool_call_id.0,
            tool_call.title,
            tool_call_status_to_string(tool_call.status)
        ),
        SessionUpdate::ToolCallUpdate(update) => format!(
            "tool_call_update id={} fields={}",
            update.tool_call_id.0,
            to_json_log(&update.fields)
        ),
        SessionUpdate::Plan(plan) => format!("plan entry_count={}", plan.entries.len()),
        SessionUpdate::AvailableCommandsUpdate(update) => {
            format!(
                "available_commands_update count={}",
                update.available_commands.len()
            )
        }
        SessionUpdate::CurrentModeUpdate(update) => {
            format!(
                "current_mode_update current_mode_id={}",
                update.current_mode_id.0
            )
        }
        SessionUpdate::ConfigOptionUpdate(update) => {
            format!("config_option_update count={}", update.config_options.len())
        }
        _ => "unknown_update".to_string(),
    }
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

fn summarize_text_for_log(text: &str, max_chars: usize) -> String {
    let collapsed = text.replace('\n', "\\n");
    if collapsed.is_empty() {
        return "<empty>".to_string();
    }
    truncate_for_log(&collapsed, max_chars)
}

fn truncate_for_log(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut truncated = String::new();
    for ch in text.chars().take(max_chars) {
        truncated.push(ch);
    }
    format!("{truncated}...<truncated>")
}

fn to_json_log<T: Serialize>(value: &T) -> String {
    match serde_json::to_string(value) {
        Ok(serialized) => truncate_for_log(&serialized, ACP_LOG_MAX_CHARS),
        Err(error) => format!("<json_serialize_error: {error}>"),
    }
}

fn redact_env_for_logging(env: &HashMap<String, String>) -> HashMap<String, String> {
    env.iter()
        .map(|(name, value)| {
            if is_sensitive_env_key(name) {
                (
                    name.clone(),
                    format!("<redacted:{} chars>", value.chars().count()),
                )
            } else {
                (name.clone(), truncate_for_log(value, 120))
            }
        })
        .collect()
}

fn is_sensitive_env_key(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [
        "key",
        "token",
        "secret",
        "password",
        "passwd",
        "pwd",
        "credential",
        "cookie",
        "session",
        "auth",
        "private",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn log_acp_wire_line(agent_id: &str, direction: LineDirection, line: &str) {
    let payload = truncate_for_log(&line.replace('\n', "\\n"), ACP_LOG_MAX_CHARS);
    match direction {
        LineDirection::Stderr => {
            if payload.to_ascii_lowercase().contains("error") {
                log::warn!("[acp-wire][{agent_id}][stderr] {payload}");
            } else {
                log::info!("[acp-wire][{agent_id}][stderr] {payload}");
            }
        }
        LineDirection::Stdout => log::debug!("[acp-wire][{agent_id}][stdout] {payload}"),
        LineDirection::Stdin => log::debug!("[acp-wire][{agent_id}][stdin] {payload}"),
    }
}

fn tool_call_to_event(tool_call: &ToolCall) -> AgentEvent {
    let content = tool_call_content_to_string(&tool_call.content);
    let locations = tool_call_locations_to_strings(&tool_call.locations);
    AgentEvent::ToolCallUpdate {
        tool_call_id: tool_call.tool_call_id.0.to_string(),
        title: tool_call.title.clone(),
        kind: tool_kind_to_string(tool_call.kind),
        status: tool_call_status_to_string(tool_call.status),
        content,
        locations,
    }
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

fn to_agent_info(response: &sacp::schema::InitializeResponse) -> AgentInfo {
    match response.agent_info.as_ref() {
        Some(info) => AgentInfo {
            name: info.title.clone().unwrap_or_else(|| info.name.clone()),
            version: info.version.clone(),
        },
        None => AgentInfo {
            name: "agent".to_string(),
            version: "unknown".to_string(),
        },
    }
}

fn to_session_info(
    session: &sacp::ActiveSession<'static, sacp::link::ClientToAgent>,
) -> SessionInfo {
    let (available_modes, available_commands) = session
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
            (parsed_modes, Vec::new())
        })
        .unwrap_or_else(|| (Vec::new(), Vec::new()));

    SessionInfo {
        session_id: session.session_id().0.to_string(),
        available_modes,
        available_commands,
    }
}

fn build_agent(
    agent_id: &str,
    command: String,
    env: HashMap<String, String>,
) -> Result<AcpAgent, String> {
    log::info!(
        "[acp][{agent_id}] build_agent command='{}' env={}",
        command,
        to_json_log(&redact_env_for_logging(&env))
    );
    let parsed = AcpAgent::from_str(&command)
        .map_err(|error| format!("invalid command '{command}': {error}"))?;
    let mut server = parsed.into_server();
    match &mut server {
        sacp::schema::McpServer::Stdio(stdio) => {
            let mut merged_env_names = Vec::new();
            for (name, value) in env {
                let env_name = name.clone();
                if let Some(existing) = stdio.env.iter_mut().find(|variable| variable.name == name)
                {
                    existing.value = value;
                } else {
                    stdio.env.push(sacp::schema::EnvVariable::new(name, value));
                }
                merged_env_names.push(env_name);
            }
            merged_env_names.sort();
            merged_env_names.dedup();
            log::info!(
                "[acp][{agent_id}] build_agent stdio command='{}' args={} merged_env_names={}",
                stdio.command.display(),
                stdio.args.len(),
                to_json_log(&merged_env_names)
            );
        }
        _ => {
            return Err(
                "only stdio agent commands are currently supported by this client".to_string(),
            );
        }
    }
    let wire_agent_id = agent_id.to_string();
    Ok(AcpAgent::new(server).with_debug(move |line, direction| {
        log_acp_wire_line(&wire_agent_id, direction, line);
    }))
}

async fn resolve_permission_selection(
    shared: &Arc<tokio::sync::Mutex<RuntimeShared>>,
    request_id: String,
    selection: Option<String>,
) -> Result<(), String> {
    let decision_tx = {
        let mut runtime = shared.lock().await;
        runtime.pending_permissions.remove(&request_id)
    };

    let Some(decision_tx) = decision_tx else {
        return Err(format!("permission request '{request_id}' not found"));
    };

    decision_tx
        .send(selection)
        .map_err(|_| format!("permission request '{request_id}' is no longer waiting"))
}

async fn cancel_pending_permissions(shared: &Arc<tokio::sync::Mutex<RuntimeShared>>) {
    let pending = {
        let mut runtime = shared.lock().await;
        runtime
            .pending_permissions
            .drain()
            .map(|(_, sender)| sender)
            .collect::<Vec<_>>()
    };
    for sender in pending {
        let _ = sender.send(None);
    }
}

async fn set_active_stream(shared: &Arc<tokio::sync::Mutex<RuntimeShared>>, active: ActiveStream) {
    let mut runtime = shared.lock().await;
    runtime.active_stream = Some(active);
}

async fn clear_active_stream(shared: &Arc<tokio::sync::Mutex<RuntimeShared>>) {
    let mut runtime = shared.lock().await;
    runtime.active_stream = None;
}

async fn remove_agent_handle_from_app_state(app_handle: &AppHandle, agent_id: &str) {
    if let Some(state) = app_handle.try_state::<AcpState>() {
        let mut inner = state.0.lock().await;
        inner.agents.remove(agent_id);
    }
}

fn emit_agent_crashed(app_handle: &AppHandle, agent_id: &str, message: &str) {
    log::error!("[acp][{agent_id}] agent crashed: {message}");
    let payload = AgentCrashPayload {
        agent_id: agent_id.to_string(),
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
