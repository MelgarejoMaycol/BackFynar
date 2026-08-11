export interface WorkspaceMembershipContext {
  workspaceId: string;
  userId: string;
  roleId: string;
  roleCode: string;
  permissions: string[];
  workspace: {
    id: string;
    name: string;
    type: "PERSONAL" | "FAMILY" | "BUSINESS";
    baseCurrency: string;
    timezone: string;
    isActive: boolean;
  };
}
