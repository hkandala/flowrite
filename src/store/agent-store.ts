import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import { toast } from "sonner";
import { create } from "zustand";

import { SETTINGS_STORE_PATH } from "@/lib/constants";
import { getBaseDir } from "@/lib/utils";

const AGENT_CONFIGS_KEY = "agent-configs";
const REGISTRY_LOADED_KEY = "registry-loaded";
const LAST_SELECTED_AGENT_KEY = "last-selected-agent";
const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";
type PlanEntryStatus = "pending" | "in_progress" | "completed";

export interface AgentConfig {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  repository?: string;
  command: string;
  env: Record<string, string>;
  source: "registry" | "custom";
  commandConfigured: boolean;
  downloadUrl?: string;
  lastLogFile?: string;
}

export interface SessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface ModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface ConnectionError {
  kind: "auth_required" | "internal" | "crashed" | "timeout" | "unknown";
  message: string;
  authMethods?: AuthMethodInfo[];
}

export interface AuthMethodInfo {
  id: string;
  name: string;
  description?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface PermissionRequest {
  requestId: string;
  toolCallId: string;
  options: {
    optionId: string;
    name: string;
    kind: string;
  }[];
}

export interface DiffData {
  path: string;
  oldText: string | null;
  newText: string | null;
}

export interface ToolCall {
  id: string;
  title: string;
  kind: string;
  status: ToolCallStatus;
  startedAt: number;
  content?: string;
  locations?: string[];
  diffData?: DiffData;
}

export interface PlanEntry {
  content: string;
  status: PlanEntryStatus;
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "toolCall"; toolCallId: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking: string;
  thinkingStartedAt: number | null;
  toolCalls: ToolCall[];
  plan: PlanEntry[];
  segments: MessageSegment[];
  isStreaming: boolean;
  editorValue?: any[];
}

// ─── Chat Session (runtime state per session) ───

export interface ChatSession {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentConfigId: string;
  logFile: string | null;

  messages: ChatMessage[];
  isResponding: boolean;
  pendingPermissions: PermissionRequest[];
  inputText: string;

  availableModes: SessionMode[];
  currentModeId: string | null;
  lastSentModeId: string | null;
  availableCommands: SlashCommand[];
  availableModels: ModelInfo[];
  currentModelId: string | null;
  lastSentModelId: string | null;
}

// ─── Chat Tab (lightweight UI view) ───

export interface ChatTab {
  id: string;
  sessionId: string | null;
  agentConfigId: string;
  label: string;
  isConnecting: boolean;
  connectionError: ConnectionError | null;
}

// ─── Store Interface ───

interface AgentConfigState {
  agents: AgentConfig[];
  registryLoaded: boolean;
  lastSelectedAgentId: string | null;
}

interface AgentConfigActions {
  initAgents: () => Promise<void>;
  setLastSelectedAgent: (id: string) => Promise<void>;
  updateAgent: (id: string, partial: Partial<AgentConfig>) => Promise<void>;
  addAgent: (config: {
    name: string;
    command: string;
    env?: Record<string, string>;
    version?: string;
    description?: string;
  }) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
}

interface ChatSessionState {
  sessions: Record<string, ChatSession>;
  chatTabs: ChatTab[];
  activeChatTabId: string | null;
}

interface ChatSessionActions {
  connect: (agentConfigId: string) => Promise<void>;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  sendPrompt: (
    sessionId: string,
    text: string,
    editorValue?: any[],
  ) => Promise<void>;
  cancelPrompt: (sessionId: string) => Promise<void>;
  respondPermission: (
    sessionId: string,
    requestId: string,
    optionId: string,
  ) => Promise<void>;
  newChat: () => Promise<void>;
  setMode: (sessionId: string, modeId: string) => void;
  setModel: (sessionId: string, modelId: string) => void;
  setInputText: (sessionId: string, text: string) => void;
}

type AgentStore = AgentConfigState &
  AgentConfigActions &
  ChatSessionState &
  ChatSessionActions;

interface AgentInfoResponse {
  agentId: string;
  name: string;
  version: string;
  authMethods: AuthMethodInfo[];
  logFile: string | null;
}

interface SessionInfoResponse {
  sessionId: string;
  availableModes: SessionMode[];
  currentModeId: string | null;
  availableCommands: SlashCommand[];
  availableModels: ModelInfo[];
  currentModelId: string | null;
}

interface AgentCrashedPayload {
  agentId: string;
  kind?: string;
  message?: string;
}

type AgentEvent =
  | { event: "messageChunk"; data: { text: string } }
  | { event: "thinkingChunk"; data: { text: string } }
  | {
      event: "toolCallUpdate";
      data: {
        toolCallId: string;
        title: string;
        kind: string;
        status: string;
        content?: string;
        locations?: string[];
        diffData?: DiffData;
      };
    }
  | {
      event: "permissionRequest";
      data: {
        requestId: string;
        toolCallId: string;
        options: { optionId: string; name: string; kind: string }[];
      };
    }
  | {
      event: "planUpdate";
      data: {
        entries: { content: string; status: string }[];
      };
    }
  | { event: "modeUpdate"; data: { currentModeId: string } }
  | {
      event: "commandsUpdate";
      data: { commands: SlashCommand[] };
    }
  | { event: "done"; data: { stopReason: string } }
  | { event: "error"; data: { message: string } };

interface RegistryResponse {
  agents: RegistryAgent[];
}

interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  repository?: string;
  distribution?: {
    npx?: {
      package: string;
      args?: string[];
      env?: Record<string, string>;
    };
    binary?: Record<
      string,
      {
        archive?: string;
        cmd?: string;
        env?: Record<string, string>;
      }
    >;
  };
}

let settingsStore: Store | null = null;
let crashListenerRegistered = false;

const getSettingsStore = async (): Promise<Store> => {
  if (!settingsStore) {
    settingsStore = await Store.load(SETTINGS_STORE_PATH);
  }
  return settingsStore;
};

const createId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const parseConnectionError = (error: unknown): ConnectionError => {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error);
      if (
        parsed &&
        typeof parsed.kind === "string" &&
        typeof parsed.message === "string"
      ) {
        return parsed as ConnectionError;
      }
    } catch {
      // not JSON, fall through
    }
    return { kind: "unknown", message: error };
  }
  const message = error instanceof Error ? error.message : "unknown error";
  // try parsing the error message as JSON (tauri wraps errors as strings)
  try {
    const parsed = JSON.parse(message);
    if (
      parsed &&
      typeof parsed.kind === "string" &&
      typeof parsed.message === "string"
    ) {
      return parsed as ConnectionError;
    }
  } catch {
    // not JSON
  }
  return { kind: "unknown", message };
};

const normalizeToolStatus = (status: string): ToolCallStatus => {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
};

const normalizePlanStatus = (status: string): PlanEntryStatus => {
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  return "pending";
};

const finalizeAssistantMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  isStreaming: false,
});

const updateAssistantMessage = (
  messages: ChatMessage[],
  assistantId: string,
  updater: (message: ChatMessage) => ChatMessage,
) =>
  messages.map((message) =>
    message.id === assistantId ? updater(message) : message,
  );

const deriveRegistryAgentCommand = (agent: RegistryAgent) => {
  const npx = agent.distribution?.npx;
  if (npx?.package) {
    const args = npx.args ?? [];
    const command = ["npx", "--yes", npx.package, ...args].join(" ").trim();
    return {
      command,
      env: npx.env ?? {},
      commandConfigured: true,
      downloadUrl: undefined,
    };
  }

  const binaryTargets = agent.distribution?.binary;
  const firstTarget = binaryTargets
    ? Object.values(binaryTargets).find(Boolean)
    : undefined;

  return {
    command: "",
    env: firstTarget?.env ?? {},
    commandConfigured: false,
    downloadUrl: firstTarget?.archive,
  };
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("failed to read icon blob"));
    reader.readAsDataURL(blob);
  });

const resolveAgentIcon = async (
  iconUrl?: string,
): Promise<string | undefined> => {
  if (!iconUrl) return undefined;

  try {
    const response = await fetch(iconUrl);
    if (!response.ok) {
      return iconUrl;
    }
    const blob = await response.blob();
    return await blobToDataUrl(blob);
  } catch {
    return iconUrl;
  }
};

const toAgentConfig = async (agent: RegistryAgent): Promise<AgentConfig> => {
  const derived = deriveRegistryAgentCommand(agent);
  return {
    id: agent.id,
    name: agent.name,
    version: agent.version,
    description: agent.description,
    icon: await resolveAgentIcon(agent.icon),
    repository: agent.repository,
    source: "registry",
    command: derived.command,
    env: derived.env,
    commandConfigured: derived.commandConfigured,
    downloadUrl: derived.downloadUrl,
  };
};

const fetchRegistryAgents = async (): Promise<RegistryAgent[]> => {
  const response = await fetch(ACP_REGISTRY_URL, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `failed to fetch ACP registry: ${response.status} ${response.statusText}`,
    );
  }

  const registry = (await response.json()) as RegistryResponse;
  return registry.agents ?? [];
};

const mergeRegistryMetadata = async (
  savedAgents: AgentConfig[],
): Promise<AgentConfig[]> => {
  const registryAgents = await fetchRegistryAgents();
  const registryConfigs = await Promise.all(registryAgents.map(toAgentConfig));
  const registryById = new Map(
    registryConfigs.map((registryAgent) => [registryAgent.id, registryAgent]),
  );

  return savedAgents.map((savedAgent) => {
    if (savedAgent.source !== "registry") {
      return savedAgent;
    }

    const metadata = registryById.get(savedAgent.id);
    if (!metadata) {
      return savedAgent;
    }

    return {
      ...savedAgent,
      version: metadata.version,
      description: metadata.description,
      icon: metadata.icon ?? savedAgent.icon,
      repository: metadata.repository,
      downloadUrl: metadata.downloadUrl,
    };
  });
};

const persistAgentSettings = async (
  agents: AgentConfig[],
  registryLoaded: boolean,
) => {
  const store = await getSettingsStore();
  await store.set(AGENT_CONFIGS_KEY, agents);
  await store.set(REGISTRY_LOADED_KEY, registryLoaded);
  await store.save();
};

// ─── Session Helper ───

const updateSession = (
  set: (updater: (current: AgentStore) => Partial<AgentStore>) => void,
  sessionId: string,
  updater:
    | Partial<ChatSession>
    | ((session: ChatSession) => Partial<ChatSession>),
) => {
  set((current) => {
    const session = current.sessions[sessionId];
    if (!session) return {};
    const updates = typeof updater === "function" ? updater(session) : updater;
    return {
      sessions: {
        ...current.sessions,
        [sessionId]: { ...session, ...updates },
      },
    };
  });
};

// ─── Crash Listener ───

const ensureCrashListener = () => {
  if (crashListenerRegistered) return;
  crashListenerRegistered = true;

  void listen<AgentCrashedPayload>("acp-agent-crashed", (event) => {
    const { sessions, chatTabs } = useAgentStore.getState();

    const rawMessage =
      event.payload.message ?? "agent process stopped unexpectedly";
    const kind = event.payload.kind ?? "crashed";

    // Find all sessions using this agentId
    const affected = Object.values(sessions).filter(
      (s) => s.agentId === event.payload.agentId,
    );
    if (affected.length === 0 && chatTabs.length === 0) return;

    // Update each affected session
    const updatedSessions = { ...sessions };
    for (const session of affected) {
      updatedSessions[session.sessionId] = {
        ...session,
        isResponding: false,
        pendingPermissions: [],
      };
    }

    // Update any connecting tabs for this agent
    const affectedAgentConfigIds = new Set(
      affected.map((s) => s.agentConfigId),
    );
    const updatedTabs = chatTabs.map((tab) => {
      const tabSession = tab.sessionId ? sessions[tab.sessionId] : null;
      if (
        tabSession?.agentId === event.payload.agentId ||
        (!tab.sessionId && affectedAgentConfigIds.has(tab.agentConfigId))
      ) {
        return {
          ...tab,
          isConnecting: false,
          connectionError: {
            kind: kind as ConnectionError["kind"],
            message: rawMessage,
          },
        };
      }
      return tab;
    });

    useAgentStore.setState({
      sessions: updatedSessions,
      chatTabs: updatedTabs,
    });
    toast.error("agent crashed", { description: rawMessage });
  });
};

// ─── Store ───

export const useAgentStore = create<AgentStore>((set, get) => ({
  // ─── Agent Config State ───
  agents: [],
  registryLoaded: false,
  lastSelectedAgentId: null,

  // ─── Chat Session State ───
  sessions: {},
  chatTabs: [],
  activeChatTabId: null,

  // ─── Agent Config Actions ───

  initAgents: async () => {
    ensureCrashListener();

    try {
      const store = await getSettingsStore();
      const savedLoaded = await store.get<boolean>(REGISTRY_LOADED_KEY);
      const savedAgents = await store.get<AgentConfig[]>(AGENT_CONFIGS_KEY);
      const lastAgent = await store.get<string>(LAST_SELECTED_AGENT_KEY);

      if (savedLoaded && Array.isArray(savedAgents)) {
        const shouldBackfillRegistryMetadata = savedAgents.some(
          (agent) =>
            agent.source === "registry" &&
            (!agent.icon ||
              agent.icon.trim().length === 0 ||
              agent.icon.startsWith("http://") ||
              agent.icon.startsWith("https://")),
        );

        let nextAgents = savedAgents;
        if (shouldBackfillRegistryMetadata) {
          try {
            nextAgents = await mergeRegistryMetadata(savedAgents);
            await persistAgentSettings(nextAgents, true);
          } catch {
            nextAgents = savedAgents;
          }
        }

        set({
          agents: nextAgents,
          registryLoaded: true,
          lastSelectedAgentId: lastAgent ?? null,
        });
        return;
      }

      const registryAgentsRaw = await fetchRegistryAgents();
      const registryAgents = await Promise.all(
        registryAgentsRaw.map(toAgentConfig),
      );

      set({
        agents: registryAgents,
        registryLoaded: true,
        lastSelectedAgentId: lastAgent ?? null,
      });

      await persistAgentSettings(registryAgents, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to initialize agents";
      toast.error("agent setup failed", { description: message });
    }
  },

  setLastSelectedAgent: async (id) => {
    set({ lastSelectedAgentId: id });
    const store = await getSettingsStore();
    await store.set(LAST_SELECTED_AGENT_KEY, id);
    await store.save();
  },

  updateAgent: async (id, partial) => {
    const nextAgents = get().agents.map((agent) => {
      if (agent.id !== id) return agent;
      const command =
        partial.command !== undefined ? partial.command : agent.command;
      return {
        ...agent,
        ...partial,
        commandConfigured:
          partial.commandConfigured ?? command.trim().length > 0,
      };
    });
    set({ agents: nextAgents });
    await persistAgentSettings(nextAgents, get().registryLoaded);
  },

  addAgent: async (config) => {
    const command = config.command.trim();
    const nextAgent: AgentConfig = {
      id: `custom-${createId()}`,
      name: config.name.trim() || "custom agent",
      version: config.version?.trim() || "custom",
      description: config.description?.trim() || "custom AI agent",
      command,
      env: config.env ?? {},
      source: "custom",
      commandConfigured: command.length > 0,
    };
    const nextAgents = [...get().agents, nextAgent];
    set({ agents: nextAgents });
    await persistAgentSettings(nextAgents, get().registryLoaded);
  },

  removeAgent: async (id) => {
    const state = get();
    const nextAgents = state.agents.filter((agent) => agent.id !== id);

    // Close tabs for this agent config
    const remainingTabs = state.chatTabs.filter(
      (tab) => tab.agentConfigId !== id,
    );

    // Remove sessions for this agent config
    const nextSessions = { ...state.sessions };
    for (const [sessionId, session] of Object.entries(nextSessions)) {
      if (session.agentConfigId === id) {
        delete nextSessions[sessionId];
      }
    }

    // Update active tab if needed
    let nextActiveTabId = state.activeChatTabId;
    if (
      nextActiveTabId &&
      !remainingTabs.some((tab) => tab.id === nextActiveTabId)
    ) {
      nextActiveTabId =
        remainingTabs.length > 0
          ? remainingTabs[remainingTabs.length - 1].id
          : null;
    }

    set({
      agents: nextAgents,
      chatTabs: remainingTabs,
      sessions: nextSessions,
      activeChatTabId: nextActiveTabId,
    });

    await persistAgentSettings(nextAgents, get().registryLoaded);
  },

  // ─── Chat Session Actions ───

  connect: async (agentConfigId) => {
    const agent = get().agents.find(
      (candidate) => candidate.id === agentConfigId,
    );
    if (!agent) return;
    if (!agent.commandConfigured || agent.command.trim().length === 0) return;

    const tabId = createId();
    const tab: ChatTab = {
      id: tabId,
      sessionId: null,
      agentConfigId,
      label: agent.name,
      isConnecting: true,
      connectionError: null,
    };

    set((current) => ({
      chatTabs: [...current.chatTabs, tab],
      activeChatTabId: tabId,
    }));

    try {
      const info = await invoke<AgentInfoResponse>("acp_connect", {
        command: agent.command,
        env: agent.env,
      });

      // Check if tab still exists
      if (!get().chatTabs.some((t) => t.id === tabId)) return;

      let session: SessionInfoResponse;
      try {
        const cwd = await getBaseDir();
        session = await invoke<SessionInfoResponse>("acp_new_session", {
          agentId: info.agentId,
          cwd,
        });
      } catch (sessionError) {
        if (!get().chatTabs.some((t) => t.id === tabId)) return;
        const connectionError = parseConnectionError(sessionError);
        if (
          connectionError.kind === "auth_required" &&
          info.authMethods?.length > 0
        ) {
          connectionError.authMethods = info.authMethods;
        }
        set((current) => ({
          chatTabs: current.chatTabs.map((t) =>
            t.id === tabId ? { ...t, isConnecting: false, connectionError } : t,
          ),
        }));
        if (connectionError.kind !== "auth_required") {
          toast.error("connection failed", {
            description: connectionError.message,
          });
        }
        return;
      }

      if (!get().chatTabs.some((t) => t.id === tabId)) return;

      const chatSession: ChatSession = {
        sessionId: session.sessionId,
        agentId: info.agentId,
        agentName: info.name,
        agentConfigId,
        logFile: info.logFile ?? null,
        messages: [],
        isResponding: false,
        pendingPermissions: [],
        inputText: "",
        availableModes: session.availableModes ?? [],
        currentModeId:
          session.currentModeId ?? session.availableModes?.[0]?.id ?? null,
        lastSentModeId:
          session.currentModeId ?? session.availableModes?.[0]?.id ?? null,
        availableCommands: session.availableCommands ?? [],
        availableModels: session.availableModels ?? [],
        currentModelId: session.currentModelId ?? null,
        lastSentModelId: session.currentModelId ?? null,
      };

      set((current) => ({
        sessions: {
          ...current.sessions,
          [session.sessionId]: chatSession,
        },
        chatTabs: current.chatTabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                sessionId: session.sessionId,
                isConnecting: false,
                connectionError: null,
              }
            : t,
        ),
        agents: info.logFile
          ? current.agents.map((a) =>
              a.id === agentConfigId ? { ...a, lastLogFile: info.logFile! } : a,
            )
          : current.agents,
      }));
    } catch (error) {
      if (!get().chatTabs.some((t) => t.id === tabId)) return;
      const connectionError = parseConnectionError(error);
      set((current) => ({
        chatTabs: current.chatTabs.map((t) =>
          t.id === tabId ? { ...t, isConnecting: false, connectionError } : t,
        ),
      }));
      toast.error("connection failed", {
        description: connectionError.message,
      });
    }
  },

  closeTab: (tabId) => {
    set((current) => {
      const tab = current.chatTabs.find((t) => t.id === tabId);
      const nextTabs = current.chatTabs.filter((t) => t.id !== tabId);

      // Remove the session associated with this tab
      const nextSessions = { ...current.sessions };
      if (tab?.sessionId) {
        delete nextSessions[tab.sessionId];
      }

      return {
        chatTabs: nextTabs,
        sessions: nextSessions,
        activeChatTabId:
          current.activeChatTabId === tabId ? null : current.activeChatTabId,
      };
    });
  },

  switchTab: (tabId) => {
    set({ activeChatTabId: tabId });
  },

  sendPrompt: async (sessionId, rawText, editorValue) => {
    const text = rawText.trim();
    if (!text) return;

    let session = get().sessions[sessionId];
    if (!session) return;

    // If currently responding, cancel first
    if (session.isResponding) {
      await get().cancelPrompt(sessionId);
      session = get().sessions[sessionId];
      if (!session) return;
    }

    // Sync mode if changed
    if (
      session.currentModeId !== null &&
      session.currentModeId !== session.lastSentModeId
    ) {
      try {
        await invoke("acp_set_mode", {
          agentId: session.agentId,
          sessionId,
          modeId: session.currentModeId,
        });
        updateSession(set, sessionId, {
          lastSentModeId: session.currentModeId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "failed to set mode";
        toast.error("mode sync failed", { description: message });
        return;
      }
    }

    // Re-read after mode sync
    session = get().sessions[sessionId];
    if (!session) return;

    // Sync model if changed
    if (
      session.currentModelId !== null &&
      session.currentModelId !== session.lastSentModelId
    ) {
      try {
        await invoke("acp_set_model", {
          agentId: session.agentId,
          sessionId,
          modelId: session.currentModelId,
        });
        updateSession(set, sessionId, {
          lastSentModelId: session.currentModelId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "failed to set model";
        toast.error("model sync failed", { description: message });
        return;
      }
    }

    // Re-read after model sync to get fresh agentId for the invoke call
    session = get().sessions[sessionId];
    if (!session) return;

    // On the first message of a session, prepend the system prompt
    let promptText = text;
    if (session.messages.length === 0) {
      try {
        const systemPrompt = await invoke<string>("read_system_prompt");
        if (systemPrompt) {
          promptText = `<system_prompt>\n${systemPrompt}\n</system_prompt>\n\n${text}`;
        }
      } catch (error) {
        console.warn("failed to load system prompt:", error);
      }
    }

    const userMessageId = createId();
    const assistantMessageId = createId();
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: text,
      thinking: "",
      thinkingStartedAt: null,
      toolCalls: [],
      plan: [],
      segments: [],
      isStreaming: false,
      editorValue,
    };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      thinking: "",
      thinkingStartedAt: null,
      toolCalls: [],
      plan: [],
      segments: [],
      isStreaming: true,
    };

    updateSession(set, sessionId, (s) => ({
      inputText: "",
      isResponding: true,
      pendingPermissions: [],
      messages: [...s.messages, userMessage, assistantMessage],
    }));

    const onEvent = new Channel<AgentEvent>();
    onEvent.onmessage = (event) => {
      set((current) => {
        const sess = current.sessions[sessionId];
        if (!sess) return {};

        const updated = { ...sess };

        switch (event.event) {
          case "messageChunk":
            updated.messages = updateAssistantMessage(
              sess.messages,
              assistantMessageId,
              (message) => {
                const segments = [...message.segments];
                const last = segments[segments.length - 1];
                if (last?.type === "text") {
                  segments[segments.length - 1] = {
                    ...last,
                    content: last.content + event.data.text,
                  };
                } else {
                  segments.push({ type: "text", content: event.data.text });
                }
                return {
                  ...message,
                  content: `${message.content}${event.data.text}`,
                  segments,
                };
              },
            );
            break;
          case "thinkingChunk":
            updated.messages = updateAssistantMessage(
              sess.messages,
              assistantMessageId,
              (message) => ({
                ...message,
                thinking: `${message.thinking}${event.data.text}`,
                thinkingStartedAt: message.thinkingStartedAt ?? Date.now(),
              }),
            );
            break;
          case "toolCallUpdate":
            updated.messages = updateAssistantMessage(
              sess.messages,
              assistantMessageId,
              (message) => {
                const existing = message.toolCalls.find(
                  (toolCall) => toolCall.id === event.data.toolCallId,
                );
                const nextToolCall: ToolCall = {
                  id: event.data.toolCallId,
                  title: event.data.title || existing?.title || "tool",
                  kind: event.data.kind || existing?.kind || "other",
                  status: normalizeToolStatus(event.data.status),
                  startedAt: existing?.startedAt ?? Date.now(),
                  content: event.data.content ?? existing?.content,
                  locations: event.data.locations ?? existing?.locations,
                  diffData: event.data.diffData ?? existing?.diffData,
                };
                const nextToolCalls = existing
                  ? message.toolCalls.map((toolCall) =>
                      toolCall.id === event.data.toolCallId
                        ? nextToolCall
                        : toolCall,
                    )
                  : [...message.toolCalls, nextToolCall];
                const segments = existing
                  ? message.segments
                  : [
                      ...message.segments,
                      {
                        type: "toolCall" as const,
                        toolCallId: event.data.toolCallId,
                      },
                    ];
                return {
                  ...message,
                  toolCalls: nextToolCalls,
                  segments,
                };
              },
            );
            break;
          case "planUpdate":
            updated.messages = updateAssistantMessage(
              sess.messages,
              assistantMessageId,
              (message) => ({
                ...message,
                plan: event.data.entries.map((entry) => ({
                  content: entry.content,
                  status: normalizePlanStatus(entry.status),
                })),
              }),
            );
            break;
          case "permissionRequest":
            updated.pendingPermissions = [
              ...sess.pendingPermissions,
              {
                requestId: event.data.requestId,
                toolCallId: event.data.toolCallId,
                options: event.data.options.map((option) => ({
                  optionId: option.optionId,
                  name: option.name,
                  kind: option.kind,
                })),
              },
            ];
            break;
          case "modeUpdate":
            updated.currentModeId = event.data.currentModeId;
            updated.lastSentModeId = event.data.currentModeId;
            break;
          case "commandsUpdate":
            updated.availableCommands = event.data.commands;
            break;
          case "done":
            updated.isResponding = false;
            updated.pendingPermissions = [];
            updated.messages = updateAssistantMessage(
              updated.messages,
              assistantMessageId,
              finalizeAssistantMessage,
            );
            break;
          case "error":
            updated.isResponding = false;
            updated.pendingPermissions = [];
            updated.messages = updateAssistantMessage(
              updated.messages,
              assistantMessageId,
              (message) =>
                finalizeAssistantMessage({
                  ...message,
                  content: message.content
                    ? `${message.content}\n\n${event.data.message}`
                    : event.data.message,
                }),
            );
            break;
        }

        return {
          sessions: { ...current.sessions, [sessionId]: updated },
        };
      });
    };

    try {
      await invoke("acp_prompt", {
        agentId: session.agentId,
        sessionId,
        text: promptText,
        onEvent,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to send prompt";
      updateSession(set, sessionId, (s) => ({
        isResponding: false,
        pendingPermissions: [],
        messages: updateAssistantMessage(
          s.messages,
          assistantMessageId,
          (messageState) =>
            finalizeAssistantMessage({
              ...messageState,
              content: messageState.content
                ? `${messageState.content}\n\n${message}`
                : message,
            }),
        ),
      }));
    }
  },

  respondPermission: async (sessionId, requestId, optionId) => {
    const session = get().sessions[sessionId];
    if (!session) return;

    try {
      await invoke("acp_respond_permission", {
        agentId: session.agentId,
        requestId,
        optionId,
      });
      updateSession(set, sessionId, (s) => ({
        pendingPermissions: s.pendingPermissions.filter(
          (p) => p.requestId !== requestId,
        ),
      }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "failed to send permission response";
      toast.error("permission response failed", { description: message });
    }
  },

  cancelPrompt: async (sessionId) => {
    const session = get().sessions[sessionId];
    if (!session || !session.isResponding) return;

    try {
      await invoke("acp_cancel", {
        agentId: session.agentId,
        sessionId,
      });
      updateSession(set, sessionId, { pendingPermissions: [] });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to cancel prompt";
      toast.error("cancel failed", { description: message });
    }
  },

  newChat: async () => {
    const state = get();
    const activeTab = state.chatTabs.find(
      (t) => t.id === state.activeChatTabId,
    );
    if (!activeTab) return;

    const agentConfigId = activeTab.agentConfigId;
    const activeSession = activeTab.sessionId
      ? state.sessions[activeTab.sessionId]
      : null;
    const agentId = activeSession?.agentId;

    if (!agentId) {
      // No existing session, run full connect flow
      await get().connect(agentConfigId);
      return;
    }

    const tabId = createId();
    const agent = state.agents.find((a) => a.id === agentConfigId);
    const tab: ChatTab = {
      id: tabId,
      sessionId: null,
      agentConfigId,
      label: agent?.name ?? activeSession?.agentName ?? "ai agent",
      isConnecting: true,
      connectionError: null,
    };

    set((current) => ({
      chatTabs: [...current.chatTabs, tab],
      activeChatTabId: tabId,
    }));

    try {
      const cwd = await getBaseDir();
      const session = await invoke<SessionInfoResponse>("acp_new_session", {
        agentId,
        cwd,
      });

      if (!get().chatTabs.some((t) => t.id === tabId)) return;

      const chatSession: ChatSession = {
        sessionId: session.sessionId,
        agentId,
        agentName: activeSession?.agentName ?? agent?.name ?? "ai agent",
        agentConfigId,
        logFile: activeSession?.logFile ?? null,
        messages: [],
        isResponding: false,
        pendingPermissions: [],
        inputText: "",
        availableModes: session.availableModes ?? [],
        currentModeId:
          session.currentModeId ?? session.availableModes?.[0]?.id ?? null,
        lastSentModeId:
          session.currentModeId ?? session.availableModes?.[0]?.id ?? null,
        availableCommands:
          session.availableCommands?.length > 0
            ? session.availableCommands
            : (activeSession?.availableCommands ?? []),
        availableModels: session.availableModels ?? [],
        currentModelId: session.currentModelId ?? null,
        lastSentModelId: session.currentModelId ?? null,
      };

      set((current) => ({
        sessions: {
          ...current.sessions,
          [session.sessionId]: chatSession,
        },
        chatTabs: current.chatTabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                sessionId: session.sessionId,
                isConnecting: false,
                connectionError: null,
              }
            : t,
        ),
      }));
    } catch (error) {
      if (!get().chatTabs.some((t) => t.id === tabId)) return;
      const connectionError = parseConnectionError(error);
      set((current) => ({
        chatTabs: current.chatTabs.map((t) =>
          t.id === tabId ? { ...t, isConnecting: false, connectionError } : t,
        ),
      }));
      toast.error("failed to start new chat", {
        description: connectionError.message,
      });
    }
  },

  setMode: (sessionId, modeId) => {
    updateSession(set, sessionId, { currentModeId: modeId });
  },

  setModel: (sessionId, modelId) => {
    updateSession(set, sessionId, { currentModelId: modelId });
  },

  setInputText: (sessionId, text) => {
    updateSession(set, sessionId, { inputText: text });
  },
}));
