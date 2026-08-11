import {
  account_nature,
  account_type,
  category_type,
  transaction_type,
  workspace_type,
} from "@prisma/client";

export const publicParameters = Object.freeze({
  options: {
    workspaceTypes: Object.values(workspace_type),
    accountTypes: Object.values(account_type),
    accountNatures: Object.values(account_nature),
    transactionTypes: Object.values(transaction_type),
    categoryTypes: Object.values(category_type),
  },
  defaults: { currency: "COP", locale: "es-CO", timezone: "America/Bogota", theme: "SYSTEM" },
});
