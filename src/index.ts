import type { Plugin } from "@opencode-ai/plugin";
import type { Session } from "@opencode-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const TmuxPlugin: Plugin = async (ctx) => {
  // Track all sessions and the currently active one
  const sessions = new Map<string, Session>();
  let activeSessionId: string | null = null;
  let currentWindowName: string | null = null;
  let isWaitingForInput = true; // Start as waiting for input

  /**
   * Check if we're running inside tmux
   */
  const isInTmux = (): boolean => {
    return !!process.env.TMUX;
  };

  /**
   * Update the tmux window name
   */
  const updateTmuxWindowName = async (sessionName: string): Promise<void> => {
    if (!isInTmux()) {
      return;
    }

    try {
      // Sanitize session name for tmux (remove special characters)
      const sanitizedName = sessionName.replace(/[^a-zA-Z0-9-_]/g, "-");
      // Add waiting indicator at the start if session is waiting for input
      const prefix = isWaitingForInput ? "● " : "";
      const windowName = `${prefix}oc-${sanitizedName}`;

      // Only update if the name changed
      if (currentWindowName === windowName) {
        return;
      }

      // Use tmux rename-window command
      await execAsync(`tmux rename-window "${windowName}"`);
      currentWindowName = windowName;
    } catch (error) {
      // Silently ignore errors
    }
  };

  /**
   * Reset the tmux window name to directory name
   */
  const resetTmuxWindowName = async (): Promise<void> => {
    if (!isInTmux()) {
      return;
    }

    try {
      // Extract the last part of the directory path
      const dirName = ctx.directory.split('/').filter(Boolean).pop() || 'oc';
      await execAsync(`tmux rename-window "${dirName}"`);
      currentWindowName = dirName;
    } catch (error) {
      // Silently ignore errors
    }
  };

  // Set initial window name to oc-{dirname} when plugin loads
  if (isInTmux()) {
    const dirName = ctx.directory.split('/').filter(Boolean).pop() || 'oc';
    try {
      await execAsync(`tmux rename-window "● oc-${dirName}"`);
      currentWindowName = `● oc-${dirName}`;
    } catch (error) {
      // Silently ignore errors
    }
  }

  // Subscribe to events directly using the SDK client
  (async () => {
    try {
      const result = await ctx.client.global.event();
      
      for await (const globalEvent of result.stream) {
        const event = globalEvent.payload;
        
        if (event.type === "session.created") {
          const sessionInfo = event.properties.info;
          if (!sessionInfo.parentID) {
            sessions.set(sessionInfo.id, sessionInfo);
            if (!activeSessionId) {
              activeSessionId = sessionInfo.id;
              const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
              await updateTmuxWindowName(sessionName);
            }
          }
        }
        
        if (event.type === "session.updated") {
          const sessionInfo = event.properties.info;
          if (sessionInfo && !sessionInfo.parentID) {
            sessions.set(sessionInfo.id, sessionInfo);
            if (sessionInfo.id === activeSessionId) {
              const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
              await updateTmuxWindowName(sessionName);
            }
          }
        }
      }
    } catch (error) {
      console.error("[tmux-plugin] Error in event stream:", error);
    }
  })();

  return {
    "chat.message": async (input, output) => {
      // Any message (user or assistant) indicates this session is active
      if (input.sessionID && input.sessionID !== activeSessionId) {
        activeSessionId = input.sessionID;
        
        // Check if we have this session cached
        const sessionInfo = sessions.get(input.sessionID);
        if (sessionInfo) {
          const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
          await updateTmuxWindowName(sessionName);
        } else {
          // Try to fetch the session from the server
          try {
            const response = await ctx.client.session.get({ path: { id: input.sessionID } });
            if (response.data) {
              sessions.set(input.sessionID, response.data);
              const sessionName = response.data.title || response.data.id.slice(0, 8);
              await updateTmuxWindowName(sessionName);
            } else {
              // Fallback to session ID
              await updateTmuxWindowName(input.sessionID.slice(0, 8));
            }
          } catch (error) {
            // Fallback to session ID on error
            await updateTmuxWindowName(input.sessionID.slice(0, 8));
          }
        }
      }
    },
    
    event: async (input) => {
      const { event } = input;
      const props = event.properties as Record<string, unknown> | undefined;

      // Handle session creation
      if (event.type === "session.created") {
        const sessionInfo = props?.info as Session | undefined;

        if (!sessionInfo) {
          return;
        }

        // Track all main sessions (non-subagent)
        if (!sessionInfo.parentID) {
          sessions.set(sessionInfo.id, sessionInfo);

          // If no active session yet, make this the active one
          if (!activeSessionId) {
            activeSessionId = sessionInfo.id;

            // Use session title, fallback to shortened ID
            const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
            await updateTmuxWindowName(sessionName);
          }
        }
      }

      // Handle session updates (e.g., title changes)
      if (event.type === "session.updated") {
        const sessionInfo = props?.info as Session | undefined;

        if (sessionInfo && !sessionInfo.parentID) {
          // Update our stored session info
          sessions.set(sessionInfo.id, sessionInfo);

          // If this is the active session, update window name
          if (sessionInfo.id === activeSessionId) {
            const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
            await updateTmuxWindowName(sessionName);
          }
        }
      }

      // Handle session deletion
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as Session | undefined;

        if (sessionInfo) {
          sessions.delete(sessionInfo.id);

          if (sessionInfo.id === activeSessionId) {
            activeSessionId = null;
            isWaitingForInput = false;
            await resetTmuxWindowName();
          }
        }
      }

      // Handle session idle - show waiting for input indicator
      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined;
        
        // Only show indicator for the active session
        if (sessionID === activeSessionId) {
          isWaitingForInput = true;
          const sessionInfo = sessions.get(sessionID);
          const sessionName = sessionInfo?.title || sessionID.slice(0, 8);
          await updateTmuxWindowName(sessionName);
        }
      }

      // Handle session status changes - clear indicator when busy
      if (event.type === "session.status") {
        const sessionID = props?.sessionID as string | undefined;
        const status = props?.status as { type: string } | undefined;
        
        if (sessionID === activeSessionId && status?.type === "busy") {
          isWaitingForInput = false;
          const sessionInfo = sessions.get(sessionID);
          const sessionName = sessionInfo?.title || sessionID.slice(0, 8);
          await updateTmuxWindowName(sessionName);
        }
      }

      // Handle permission asked - show waiting indicator
      if ((event as any).type === "permission.asked") {
        const sessionID = props?.sessionID as string | undefined;
        
        if (sessionID === activeSessionId) {
          isWaitingForInput = true;
          const sessionInfo = sessions.get(sessionID);
          const sessionName = sessionInfo?.title || sessionID.slice(0, 8);
          await updateTmuxWindowName(sessionName);
        }
      }

      // Handle question asked - show waiting indicator
      if ((event as any).type === "question.asked") {
        const sessionID = props?.sessionID as string | undefined;
        
        if (sessionID === activeSessionId) {
          isWaitingForInput = true;
          const sessionInfo = sessions.get(sessionID);
          const sessionName = sessionInfo?.title || sessionID.slice(0, 8);
          await updateTmuxWindowName(sessionName);
        }
      }

      // Check for TUI session select using type assertion since it's not in the Event union
      // This event exists in the API but isn't exposed to plugins by default
      if ((event as any).type === "tui.session.select") {
        const sessionID = props?.sessionID as string | undefined;

        if (sessionID && sessionID !== activeSessionId) {
          activeSessionId = sessionID;
          isWaitingForInput = true; // Assume waiting when switching sessions

          // Get session info from our stored sessions
          const sessionInfo = sessions.get(sessionID);
          if (sessionInfo) {
            const sessionName = sessionInfo.title || sessionInfo.id.slice(0, 8);
            await updateTmuxWindowName(sessionName);
          } else {
            // Session not in our map yet, use ID
            await updateTmuxWindowName(sessionID.slice(0, 8));
          }
        }
      }

      // Handle server instance disposed (OpenCode closing)
      if (event.type === "server.instance.disposed") {
        activeSessionId = null;
        isWaitingForInput = false;
        sessions.clear();
        // Reset to directory name directly
        try {
          const dirName = ctx.directory.split('/').filter(Boolean).pop() || 'oc';
          await execAsync(`tmux rename-window "${dirName}"`);
          currentWindowName = dirName;
        } catch (error) {
          console.error("[tmux-plugin] Failed to reset tmux window name on dispose:", error);
        }
      }
    },
  };
};

export default TmuxPlugin;
