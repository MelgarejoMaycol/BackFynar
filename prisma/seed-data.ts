export interface RoleSeed {
  code: string;
  name: string;
  description: string;
  isSystem: true;
}

export interface PermissionSeed {
  code: string;
  description: string;
}

export interface GlobalCategorySeed {
  name: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "INVESTMENT";
  icon: string;
  color: `#${string}`;
}

export const roles: readonly RoleSeed[] = [
  {
    code: "OWNER",
    name: "Propietario",
    description: "Control total del espacio financiero",
    isSystem: true,
  },
  {
    code: "ADMIN",
    name: "Administrador",
    description: "Administra miembros y configuración",
    isSystem: true,
  },
  {
    code: "MEMBER",
    name: "Miembro",
    description: "Gestiona información financiera",
    isSystem: true,
  },
  { code: "VIEWER", name: "Consulta", description: "Acceso de solo lectura", isSystem: true },
  {
    code: "ACCOUNTANT",
    name: "Contador",
    description: "Acceso profesional autorizado",
    isSystem: true,
  },
  {
    code: "ADVISOR",
    name: "Asesor financiero",
    description: "Analiza y recomienda sin administrar miembros",
    isSystem: true,
  },
];

export const permissions: readonly PermissionSeed[] = [
  { code: "workspace.manage", description: "Administrar el espacio financiero" },
  { code: "members.manage", description: "Administrar miembros" },
  { code: "accounts.read", description: "Consultar cuentas" },
  { code: "accounts.write", description: "Crear y modificar cuentas" },
  { code: "categories.read", description: "Consultar categorías" },
  { code: "categories.write", description: "Crear y modificar categorías" },
  { code: "transactions.read", description: "Consultar movimientos" },
  { code: "transactions.write", description: "Crear y modificar movimientos" },
  { code: "budgets.read", description: "Consultar presupuestos" },
  { code: "budgets.write", description: "Crear y modificar presupuestos" },
  { code: "debts.read", description: "Consultar deudas" },
  { code: "debts.write", description: "Crear y modificar deudas" },
  { code: "goals.read", description: "Consultar metas de ahorro" },
  { code: "goals.write", description: "Crear y modificar metas de ahorro" },
  { code: "reports.read", description: "Consultar reportes" },
  { code: "ai.use", description: "Usar análisis y simulaciones de IA" },
];

export const categoryPermissionsByRole = {
  OWNER: ["categories.read", "categories.write"],
  ADMIN: ["categories.read", "categories.write"],
  MEMBER: ["categories.read", "categories.write"],
  VIEWER: ["categories.read"],
  ACCOUNTANT: ["categories.read", "categories.write"],
  ADVISOR: ["categories.read"],
} as const;

export const globalCategories: readonly GlobalCategorySeed[] = [
  { name: "Salario", type: "INCOME", icon: "briefcase", color: "#16A34A" },
  { name: "Honorarios", type: "INCOME", icon: "receipt", color: "#15803D" },
  { name: "Ventas", type: "INCOME", icon: "store", color: "#22C55E" },
  { name: "Comisiones", type: "INCOME", icon: "percent", color: "#4ADE80" },
  { name: "Bonificaciones", type: "INCOME", icon: "gift", color: "#86EFAC" },
  { name: "Rendimientos", type: "INCOME", icon: "trending-up", color: "#059669" },
  { name: "Regalos", type: "INCOME", icon: "gift", color: "#10B981" },
  { name: "Reembolsos", type: "INCOME", icon: "rotate-ccw", color: "#34D399" },
  { name: "Otros ingresos", type: "INCOME", icon: "circle-plus", color: "#6EE7B7" },
  { name: "Alimentación", type: "EXPENSE", icon: "utensils", color: "#EF4444" },
  { name: "Transporte", type: "EXPENSE", icon: "bus", color: "#F97316" },
  { name: "Vivienda", type: "EXPENSE", icon: "house", color: "#F59E0B" },
  { name: "Servicios", type: "EXPENSE", icon: "lightbulb", color: "#EAB308" },
  { name: "Salud", type: "EXPENSE", icon: "heart-pulse", color: "#EC4899" },
  { name: "Educación", type: "EXPENSE", icon: "graduation-cap", color: "#8B5CF6" },
  { name: "Entretenimiento", type: "EXPENSE", icon: "film", color: "#A855F7" },
  { name: "Compras", type: "EXPENSE", icon: "shopping-bag", color: "#D946EF" },
  { name: "Deudas", type: "EXPENSE", icon: "landmark", color: "#DC2626" },
  { name: "Seguros", type: "EXPENSE", icon: "shield", color: "#2563EB" },
  { name: "Impuestos", type: "EXPENSE", icon: "building", color: "#475569" },
  { name: "Mascotas", type: "EXPENSE", icon: "paw-print", color: "#92400E" },
  { name: "Viajes", type: "EXPENSE", icon: "plane", color: "#0EA5E9" },
  { name: "Cuidado personal", type: "EXPENSE", icon: "sparkles", color: "#F472B6" },
  { name: "Otros gastos", type: "EXPENSE", icon: "circle-minus", color: "#64748B" },
  {
    name: "Transferencia entre cuentas",
    type: "TRANSFER",
    icon: "arrow-left-right",
    color: "#06B6D4",
  },
  { name: "Aportes a inversión", type: "INVESTMENT", icon: "wallet", color: "#4F46E5" },
  {
    name: "Rendimientos de inversión",
    type: "INVESTMENT",
    icon: "chart-line",
    color: "#7C3AED",
  },
  { name: "Retiro de inversión", type: "INVESTMENT", icon: "banknote", color: "#9333EA" },
];
