import { workspacesRepository, type WorkspacesRepository } from "./workspaces.repository.js";

const publicWorkspace = (
  context: Awaited<ReturnType<WorkspacesRepository["resolve"]>>,
  isDefault: boolean,
) => ({
  ...context.workspace,
  role: context.roleCode,
  membershipStatus: "ACTIVE" as const,
  permissions: context.permissions,
  isDefault,
});

export class WorkspacesService {
  constructor(private readonly repository: WorkspacesRepository = workspacesRepository) {}
  async list(userId: string) {
    return (await this.repository.listForUser(userId)).map((item) =>
      publicWorkspace(item, item.isDefault),
    );
  }
  async get(userId: string, workspaceId: string) {
    const [context, defaultWorkspaceId] = await Promise.all([
      this.repository.resolve(userId, workspaceId),
      this.repository.getDefaultWorkspaceId(userId),
    ]);
    return publicWorkspace(context, defaultWorkspaceId === workspaceId);
  }
  async select(userId: string, workspaceId: string) {
    const selected = await this.repository.select(userId, workspaceId);
    return {
      workspace: publicWorkspace(selected.context, true),
      defaultWorkspaceId: selected.preferences.defaultWorkspaceId,
      updatedAt: selected.preferences.updatedAt,
    };
  }
}

export const workspacesService = new WorkspacesService();
