import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { toast } from "sonner";

import { SETTINGS_STORE_PATH } from "@/lib/constants";
import { getBaseDir } from "@/lib/utils";

const AGENT_CONFIGS_KEY = "agent-configs";
const REGISTRY_LOADED_KEY = "registry-loaded";
const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
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
}

export interface SessionMode {
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

export interface ToolCall {
  id: string;
  title: string;
  kind: string;
  status: ToolCallStatus;
  content?: string;
  locations?: string[];
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
  toolCalls: ToolCall[];
  plan: PlanEntry[];
  segments: MessageSegment[];
  isStreaming: boolean;
}

interface AgentState {
  agents: AgentConfig[];
  registryLoaded: boolean;
  selectedAgentId: string | null;

  activeAgentId: string | null;
  activeSessionId: string | null;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  agentName: string | null;

  availableModes: SessionMode[];
  currentModeId: string | null;
  availableCommands: SlashCommand[];

  messages: ChatMessage[];
  isResponding: boolean;

  pendingPermission: PermissionRequest | null;
  inputText: string;
}

interface AgentActions {
  initAgents: () => Promise<void>;
  updateAgent: (id: string, partial: Partial<AgentConfig>) => Promise<void>;
  addAgent: (config: {
    name: string;
    command: string;
    env?: Record<string, string>;
    version?: string;
    description?: string;
  }) => Promise<void>;
  removeAgent: (id: string) => Promise<void>;
  selectAgent: (id: string | null) => void;

  connect: (agentId: string) => Promise<void>;
  disconnect: () => void;
  sendPrompt: (text: string) => Promise<void>;
  respondPermission: (requestId: string, optionId: string) => Promise<void>;
  cancelPrompt: () => Promise<void>;
  newChat: () => Promise<void>;
  setCurrentModeId: (modeId: string | null) => void;

  setInputText: (text: string) => void;
}

type AgentStore = AgentState & AgentActions;

interface AgentInfoResponse {
  name: string;
  version: string;
}

interface SessionInfoResponse {
  sessionId: string;
  availableModes: SessionMode[];
  availableCommands: SlashCommand[];
}

interface AgentCrashedPayload {
  agentId: string;
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

const ensureCrashListener = () => {
  if (crashListenerRegistered) return;
  crashListenerRegistered = true;

  void listen<AgentCrashedPayload>("acp-agent-crashed", (event) => {
    const { activeAgentId } = useAgentStore.getState();
    if (activeAgentId !== event.payload.agentId) {
      return;
    }

    const message =
      event.payload.message ?? "agent process stopped unexpectedly";
    useAgentStore.setState({
      connectionStatus: "error",
      connectionError: message,
      isResponding: false,
      pendingPermission: null,
    });
    toast.error("agent crashed", { description: message });
  });
};

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [],
  registryLoaded: false,
  selectedAgentId: null,

  activeAgentId: null,
  activeSessionId: null,
  connectionStatus: "disconnected",
  connectionError: null,
  agentName: null,

  availableModes: [],
  currentModeId: null,
  availableCommands: [],

  messages: [],
  isResponding: false,
  pendingPermission: null,
  inputText: "",

  initAgents: async () => {
    ensureCrashListener();

    try {
      const store = await getSettingsStore();
      const savedLoaded = await store.get<boolean>(REGISTRY_LOADED_KEY);
      const savedAgents = await store.get<AgentConfig[]>(AGENT_CONFIGS_KEY);

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

        const firstConfigured =
          nextAgents.find((agent) => agent.commandConfigured)?.id ??
          nextAgents[0]?.id ??
          null;
        set({
          agents: nextAgents,
          registryLoaded: true,
          selectedAgentId: get().selectedAgentId ?? firstConfigured,
        });
        return;
      }

      const registryAgentsRaw = await fetchRegistryAgents();
      const registryAgents = await Promise.all(
        registryAgentsRaw.map(toAgentConfig),
      );
      const selectedAgentId =
        registryAgents.find((agent) => agent.commandConfigured)?.id ??
        registryAgents[0]?.id ??
        null;

      set({
        agents: registryAgents,
        registryLoaded: true,
        selectedAgentId,
      });

      await persistAgentSettings(registryAgents, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to initialize agents";
      set({
        connectionStatus: "error",
        connectionError: message,
      });
      toast.error("agent setup failed", { description: message });
    }
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
      description: config.description?.trim() || "custom ACP agent",
      command,
      env: config.env ?? {},
      source: "custom",
      commandConfigured: command.length > 0,
    };
    const nextAgents = [...get().agents, nextAgent];
    set({
      agents: nextAgents,
      selectedAgentId: nextAgent.id,
    });
    await persistAgentSettings(nextAgents, get().registryLoaded);
  },

  removeAgent: async (id) => {
    const state = get();
    const nextAgents = state.agents.filter((agent) => agent.id !== id);
    const selectedAgentId =
      state.selectedAgentId === id
        ? (nextAgents.find((agent) => agent.commandConfigured)?.id ??
          nextAgents[0]?.id ??
          null)
        : state.selectedAgentId;

    const shouldDisconnect = state.activeAgentId === id;

    set({
      agents: nextAgents,
      selectedAgentId,
      ...(shouldDisconnect
        ? {
            activeAgentId: null,
            activeSessionId: null,
            connectionStatus: "disconnected" as const,
            connectionError: null,
            agentName: null,
            availableModes: [],
            currentModeId: null,
            availableCommands: [],
            messages: [],
            pendingPermission: null,
            isResponding: false,
          }
        : {}),
    });

    await persistAgentSettings(nextAgents, get().registryLoaded);
  },

  selectAgent: (id) => set({ selectedAgentId: id }),

  connect: async (agentId) => {
    const agent = get().agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      set({
        connectionStatus: "error",
        connectionError: "selected agent not found",
      });
      return;
    }
    if (!agent.commandConfigured || agent.command.trim().length === 0) {
      set({
        connectionStatus: "error",
        connectionError: "configure the agent command before connecting",
      });
      return;
    }

    set({
      connectionStatus: "connecting",
      connectionError: null,
      activeAgentId: agentId,
      selectedAgentId: agentId,
    });

    try {
      const info = await invoke<AgentInfoResponse>("acp_connect", {
        agentId,
        command: agent.command,
        env: agent.env,
      });
      const cwd = await getBaseDir();
      const session = await invoke<SessionInfoResponse>("acp_new_session", {
        agentId,
        cwd,
      });

      set({
        activeAgentId: agentId,
        activeSessionId: session.sessionId,
        connectionStatus: "connected",
        connectionError: null,
        agentName: info.name,
        availableModes: session.availableModes ?? [],
        currentModeId: session.availableModes?.[0]?.id ?? null,
        availableCommands: session.availableCommands ?? [],
        messages: [],
        isResponding: false,
        pendingPermission: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to connect to agent";
      set({
        connectionStatus: "error",
        connectionError: message,
        activeSessionId: null,
        isResponding: false,
      });
    }
  },

  disconnect: () =>
    set({
      activeAgentId: null,
      activeSessionId: null,
      connectionStatus: "disconnected",
      connectionError: null,
      agentName: null,
      availableModes: [],
      currentModeId: null,
      availableCommands: [],
      messages: [],
      isResponding: false,
      pendingPermission: null,
      inputText: "",
    }),

  sendPrompt: async (rawText) => {
    const state = get();
    const text = rawText.trim();
    if (!text) return;
    if (
      !state.activeAgentId ||
      !state.activeSessionId ||
      state.connectionStatus !== "connected"
    ) {
      return;
    }
    if (state.isResponding) {
      return;
    }

    const userMessageId = createId();
    const assistantMessageId = createId();
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: text,
      thinking: "",
      toolCalls: [],
      plan: [],
      segments: [],
      isStreaming: false,
    };
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      plan: [],
      segments: [],
      isStreaming: true,
    };

    set((current) => ({
      inputText: "",
      isResponding: true,
      pendingPermission: null,
      messages: [...current.messages, userMessage, assistantMessage],
    }));

    const onEvent = new Channel<AgentEvent>();
    onEvent.onmessage = (event) => {
      switch (event.event) {
        case "messageChunk":
          set((current) => ({
            messages: updateAssistantMessage(
              current.messages,
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
            ),
          }));
          break;
        case "thinkingChunk":
          set((current) => ({
            messages: updateAssistantMessage(
              current.messages,
              assistantMessageId,
              (message) => ({
                ...message,
                thinking: `${message.thinking}${event.data.text}`,
              }),
            ),
          }));
          break;
        case "toolCallUpdate":
          set((current) => ({
            messages: updateAssistantMessage(
              current.messages,
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
                  content: event.data.content ?? existing?.content,
                  locations: event.data.locations ?? existing?.locations,
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
            ),
          }));
          break;
        case "planUpdate":
          set((current) => ({
            messages: updateAssistantMessage(
              current.messages,
              assistantMessageId,
              (message) => ({
                ...message,
                plan: event.data.entries.map((entry) => ({
                  content: entry.content,
                  status: normalizePlanStatus(entry.status),
                })),
              }),
            ),
          }));
          break;
        case "permissionRequest":
          set({
            pendingPermission: {
              requestId: event.data.requestId,
              toolCallId: event.data.toolCallId,
              options: event.data.options.map((option) => ({
                optionId: option.optionId,
                name: option.name,
                kind: option.kind,
              })),
            },
          });
          break;
        case "modeUpdate":
          set({
            currentModeId: event.data.currentModeId,
          });
          break;
        case "commandsUpdate":
          set({
            availableCommands: event.data.commands,
          });
          break;
        case "done":
          set((current) => ({
            isResponding: false,
            pendingPermission: null,
            messages: updateAssistantMessage(
              current.messages,
              assistantMessageId,
              finalizeAssistantMessage,
            ),
          }));
          break;
        case "error":
          set((current) => ({
            isResponding: false,
            pendingPermission: null,
            messages: updateAssistantMessage(
              current.messages,
              assistantMessageId,
              (message) =>
                finalizeAssistantMessage({
                  ...message,
                  content: message.content
                    ? `${message.content}\n\n${event.data.message}`
                    : event.data.message,
                }),
            ),
          }));
          break;
      }
    };

    try {
      await invoke("acp_prompt", {
        agentId: state.activeAgentId,
        sessionId: state.activeSessionId,
        text,
        onEvent,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to send prompt";
      set((current) => ({
        isResponding: false,
        pendingPermission: null,
        messages: updateAssistantMessage(
          current.messages,
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

  respondPermission: async (requestId, optionId) => {
    const { activeAgentId } = get();
    if (!activeAgentId) return;

    try {
      await invoke("acp_respond_permission", {
        agentId: activeAgentId,
        requestId,
        optionId,
      });
      set({ pendingPermission: null });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "failed to send permission response";
      toast.error("permission response failed", { description: message });
    }
  },

  cancelPrompt: async () => {
    const { activeAgentId, activeSessionId } = get();
    if (!activeAgentId || !activeSessionId) return;

    try {
      await invoke("acp_cancel", {
        agentId: activeAgentId,
        sessionId: activeSessionId,
      });
      set({
        pendingPermission: null,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to cancel prompt";
      toast.error("cancel failed", { description: message });
    }
  },

  newChat: async () => {
    const { activeAgentId, connectionStatus } = get();
    if (!activeAgentId || connectionStatus !== "connected") {
      set({ messages: [] });
      return;
    }

    try {
      const cwd = await getBaseDir();
      const session = await invoke<SessionInfoResponse>("acp_new_session", {
        agentId: activeAgentId,
        cwd,
      });
      set({
        activeSessionId: session.sessionId,
        messages: [],
        pendingPermission: null,
        isResponding: false,
        availableModes: session.availableModes ?? [],
        currentModeId: session.availableModes?.[0]?.id ?? null,
        availableCommands: session.availableCommands ?? [],
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "failed to start new chat";
      set({
        connectionStatus: "error",
        connectionError: message,
      });
    }
  },

  setCurrentModeId: (modeId) => {
    set({ currentModeId: modeId });
    const { activeAgentId, activeSessionId, connectionStatus } = get();
    if (
      !modeId ||
      !activeAgentId ||
      !activeSessionId ||
      connectionStatus !== "connected"
    ) {
      return;
    }
    void invoke("acp_set_mode", {
      agentId: activeAgentId,
      sessionId: activeSessionId,
      modeId,
    }).catch((error) => {
      const message =
        error instanceof Error ? error.message : "failed to set mode";
      toast.error("mode update failed", { description: message });
    });
  },

  setInputText: (text) => set({ inputText: text }),
}));
