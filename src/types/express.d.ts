import type { WorkspaceMembershipContext } from "../modules/workspaces/workspaces.types.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: string; sessionId: string };
      workspace?: WorkspaceMembershipContext;
    }
  }
}

export {};
