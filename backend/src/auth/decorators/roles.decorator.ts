import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/**
 * Only these roles may call the route, e.g. `@Roles(UserRole.ADMIN)`
 * (v1: `authorize("ADMIN")`). Read by RolesGuard.
 * Docs: https://docs.nestjs.com/guards#setting-roles-per-handler
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
