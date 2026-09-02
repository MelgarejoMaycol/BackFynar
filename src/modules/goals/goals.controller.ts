import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { ValidationError } from "../../common/errors/app-error.js";
import {
  contributionIdSchema,
  createContributionSchema,
  createGoalSchema,
  goalIdSchema,
  listGoalsSchema,
  updateGoalSchema,
} from "./goals.schemas.js";
import { goalsService } from "./goals.service.js";

const parse = <T>(schema: ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Datos de meta inválidos", result.error.issues);
  return result.data;
};

const execute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch(next);
  };

const goalId = (request: Request) => parse(goalIdSchema, request.params.goalId);
const contributionId = (request: Request) =>
  parse(contributionIdSchema, request.params.contributionId);

export const list = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.list(req.workspace!.workspaceId, parse(listGoalsSchema, req.query)),
  });
});

export const get = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.get(req.workspace!.workspaceId, goalId(req)),
  });
});

export const projection = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.projection(req.workspace!.workspaceId, goalId(req)),
  });
});

export const create = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await goalsService.create(req.workspace!.workspaceId, parse(createGoalSchema, req.body)),
  });
});

export const update = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.update(
      req.workspace!.workspaceId,
      goalId(req),
      parse(updateGoalSchema, req.body),
    ),
  });
});

export const pause = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.setStatus(req.workspace!.workspaceId, goalId(req), "PAUSED"),
  });
});

export const resume = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.setStatus(req.workspace!.workspaceId, goalId(req), "ACTIVE"),
  });
});

export const complete = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.setStatus(req.workspace!.workspaceId, goalId(req), "COMPLETED"),
  });
});

export const archive = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.archive(req.workspace!.workspaceId, req.auth!.userId, goalId(req)),
  });
});

export const restore = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.restore(req.workspace!.workspaceId, goalId(req)),
  });
});

export const contribute = execute(async (req, res) => {
  res.status(201).json({
    success: true,
    data: await goalsService.addContribution(
      req.workspace!.workspaceId,
      req.auth!.userId,
      goalId(req),
      parse(createContributionSchema, req.body),
    ),
  });
});

export const reverseContribution = execute(async (req, res) => {
  res.status(200).json({
    success: true,
    data: await goalsService.reverseContribution(
      req.workspace!.workspaceId,
      req.auth!.userId,
      goalId(req),
      contributionId(req),
    ),
  });
});
