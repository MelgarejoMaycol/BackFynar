import { AppError, NotFoundError, ValidationError } from "../../common/errors/app-error.js";
import type { UpdatePreferencesInput, UpdateProfileInput } from "./users.schemas.js";
import { usersRepository, type UsersRepository } from "./users.repository.js";
import { optimizeAvatar, uploadAvatar } from "./avatar.service.js";

export class UsersService {
  constructor(
    private readonly repository: UsersRepository = usersRepository,
    private readonly avatarProcessor: (buffer: Buffer) => Promise<Buffer> = optimizeAvatar,
    private readonly avatarUploader: (
      userId: string,
      buffer: Buffer,
    ) => Promise<string> = uploadAvatar,
  ) {}
  async getProfile(userId: string) {
    const user = await this.repository.findActiveProfile(userId);
    if (!user) throw new NotFoundError("Usuario activo no encontrado", "Perfil no encontrado");
    return user;
  }
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const data: Prisma.UserUpdateManyMutationInput = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    };
    const updated = await this.repository.updateActiveProfile(userId, data);
    if (!updated) throw new NotFoundError("Usuario activo no encontrado", "Perfil no encontrado");
    return updated;
  }
  async updateAvatar(userId: string, original: Buffer) {
    await this.getProfile(userId);
    let optimized: Buffer;
    try {
      optimized = await this.avatarProcessor(original);
    } catch {
      throw new ValidationError("El archivo no contiene una imagen válida.");
    }
    const avatarUrl = await this.avatarUploader(userId, optimized);
    const updated = await this.repository.updateActiveProfile(userId, { avatarUrl });
    if (!updated) throw new NotFoundError("Usuario activo no encontrado", "Perfil no encontrado");
    return updated;
  }
  async getPreferences(userId: string) {
    const preferences = await this.repository.findPreferences(userId);
    if (!preferences)
      throw new AppError("Preferencias de usuario ausentes", { code: "USER_PREFERENCES_MISSING" });
    return preferences;
  }
  async updatePreferences(userId: string, input: UpdatePreferencesInput) {
    await this.getPreferences(userId);
    const data: Prisma.UserPreferenceUpdateInput = {
      ...(input.defaultWorkspaceId !== undefined
        ? input.defaultWorkspaceId === null
          ? { workspaces: { disconnect: true } }
          : { workspaces: { connect: { id: input.defaultWorkspaceId } } }
        : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.dateFormat !== undefined ? { dateFormat: input.dateFormat } : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.startScreen !== undefined ? { startScreen: input.startScreen } : {}),
      ...(input.dashboardLayout !== undefined
        ? { dashboardLayout: input.dashboardLayout as Prisma.InputJsonValue }
        : {}),
    };
    return input.defaultWorkspaceId
      ? this.repository.updatePreferencesForWorkspace(userId, input.defaultWorkspaceId, data)
      : this.repository.updatePreferences(userId, data);
  }
}

export const usersService = new UsersService();
import { Prisma } from "@prisma/client";
