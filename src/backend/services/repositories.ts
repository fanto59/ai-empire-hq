import type { AgentProfile, Business, Headquarters, Project } from "@/domain";
import type { BusinessId } from "@/domain/ids";

/**
 * Persistence ports. No database is connected yet; implementations will live
 * in src/infrastructure/persistence once a storage choice is approved.
 *
 * Isolation rule: every business-owned query takes a BusinessId and must
 * filter by it. There is intentionally no "list all tasks" method.
 */
export interface HeadquartersRepository {
  get(): Promise<Headquarters | null>;
}

export interface BusinessRepository {
  list(): Promise<Business[]>;
  getById(id: BusinessId): Promise<Business | null>;
}

export interface AgentRepository {
  listHqLevel(): Promise<AgentProfile[]>;
  listByBusiness(businessId: BusinessId): Promise<AgentProfile[]>;
}

export interface ProjectRepository {
  listByBusiness(businessId: BusinessId | null): Promise<Project[]>;
}

/** Empty repositories: the honest state of a brand-new installation. */
export const emptyRepositories = {
  headquarters: { get: async () => null } satisfies HeadquartersRepository,
  businesses: {
    list: async () => [],
    getById: async () => null,
  } satisfies BusinessRepository,
  agents: {
    listHqLevel: async () => [],
    listByBusiness: async () => [],
  } satisfies AgentRepository,
};
