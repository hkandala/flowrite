import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAgentStore } from "@/store/agent-store";

interface AgentSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AgentSettingsModal({
  open,
  onOpenChange,
}: AgentSettingsModalProps) {
  const agents = useAgentStore((s) => s.agents);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const addAgent = useAgentStore((s) => s.addAgent);
  const removeAgent = useAgentStore((s) => s.removeAgent);

  const [commandDrafts, setCommandDrafts] = useState<Record<string, string>>(
    {},
  );
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});

  const [customName, setCustomName] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customEnv, setCustomEnv] = useState("{}");

  useEffect(() => {
    if (!open) return;
    const nextCommands: Record<string, string> = {};
    const nextEnvs: Record<string, string> = {};
    for (const agent of agents) {
      nextCommands[agent.id] = agent.command;
      nextEnvs[agent.id] = JSON.stringify(agent.env ?? {}, null, 2);
    }
    setCommandDrafts(nextCommands);
    setEnvDrafts(nextEnvs);
  }, [open, agents]);

  const commitAgentCommand = async (agentId: string) => {
    const command = (commandDrafts[agentId] ?? "").trim();
    await updateAgent(agentId, {
      command,
      commandConfigured: command.length > 0,
    });
  };

  const commitAgentEnv = async (agentId: string) => {
    const raw = (envDrafts[agentId] ?? "").trim();
    if (!raw) {
      await updateAgent(agentId, { env: {} });
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        env[key] = String(value);
      }
      await updateAgent(agentId, { env });
    } catch {
      toast.error("invalid env JSON", {
        description: "environment must be a valid JSON object",
      });
    }
  };

  const handleAddCustomAgent = async () => {
    if (!customCommand.trim()) {
      toast.error("command required");
      return;
    }

    let env: Record<string, string> = {};
    const raw = customEnv.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        env = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)]),
        );
      } catch {
        toast.error("invalid env JSON", {
          description: "custom env must be a valid JSON object",
        });
        return;
      }
    }

    await addAgent({
      name: customName.trim() || "custom agent",
      command: customCommand.trim(),
      env,
      description: "custom ACP agent",
      version: "custom",
    });

    setCustomName("");
    setCustomCommand("");
    setCustomEnv("{}");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>acp agent providers</DialogTitle>
          <DialogDescription>
            configure or add your ACP agents
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 px-6 pb-6 overflow-y-auto space-y-5">
          <div className="space-y-4">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                    {agent.icon ? (
                      <img
                        src={agent.icon}
                        alt={`${agent.name} icon`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-8 w-8 rounded-sm border border-border/70 bg-transparent object-contain p-0.5 shrink-0 dark:invert dark:brightness-125"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-sm border border-border/70 bg-transparent shrink-0" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm text-foreground font-medium truncate">
                        {agent.name}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {agent.description}
                      </div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => void removeAgent(agent.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs text-muted-foreground">
                    command
                  </label>
                  <Input
                    value={commandDrafts[agent.id] ?? ""}
                    onChange={(event) =>
                      setCommandDrafts((drafts) => ({
                        ...drafts,
                        [agent.id]: event.target.value,
                      }))
                    }
                    onBlur={() => void commitAgentCommand(agent.id)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs text-muted-foreground">
                    env (JSON)
                  </label>
                  <Textarea
                    rows={4}
                    value={envDrafts[agent.id] ?? "{}"}
                    className="font-mono text-xs"
                    onChange={(event) =>
                      setEnvDrafts((drafts) => ({
                        ...drafts,
                        [agent.id]: event.target.value,
                      }))
                    }
                    onBlur={() => void commitAgentEnv(agent.id)}
                  />
                </div>

                {!agent.commandConfigured &&
                  (agent.downloadUrl || agent.repository) && (
                    <p className="text-xs text-amber-500">
                      {agent.downloadUrl && (
                        <>
                          {" "}
                          <a
                            className="underline"
                            href={agent.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            download archive
                          </a>
                          , extract it,
                        </>
                      )}
                      {!agent.downloadUrl && " install it locally,"} then set{" "}
                      <code className="font-mono text-[11px]">command</code>{" "}
                      above to the local binary path.
                      {agent.repository && (
                        <>
                          {" "}
                          see{" "}
                          <a
                            className="underline"
                            href={agent.repository}
                            target="_blank"
                            rel="noreferrer"
                          >
                            repository
                          </a>{" "}
                          for setup details.
                        </>
                      )}
                    </p>
                  )}
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
            <h3 className="text-sm text-foreground font-medium">
              add custom agent
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  name
                </label>
                <Input
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  placeholder="my custom agent"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-muted-foreground">
                  command
                </label>
                <Input
                  value={customCommand}
                  onChange={(event) => setCustomCommand(event.target.value)}
                  placeholder="npx --yes @my/agent --acp"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs text-muted-foreground">
                env (JSON)
              </label>
              <Textarea
                rows={4}
                value={customEnv}
                className="font-mono text-xs"
                onChange={(event) => setCustomEnv(event.target.value)}
              />
            </div>

            <div className="flex justify-end">
              <Button type="button" onClick={() => void handleAddCustomAgent()}>
                <Plus className="h-3.5 w-3.5" />
                add custom agent
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
