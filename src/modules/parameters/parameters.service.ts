import { publicParameters } from "./parameters.constants.js";
import { findPublicRoles, findSystemCategories } from "./parameters.repository.js";
export const getParameters = () => publicParameters;
export const getRoles = () => findPublicRoles();
export const getSystemCategories = () => findSystemCategories();
