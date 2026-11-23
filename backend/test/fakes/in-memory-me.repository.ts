import type {
  MeRepository,
  UserWithProfile,
} from '../../src/me/me.repository.js';
import type { YearOfStudy } from '../../src/generated/prisma/enums.js';

/** Stands in for MeRepository in e2e tests: user rows with their profile, in a Map. */
export class InMemoryMeRepository implements Pick<
  MeRepository,
  keyof MeRepository
> {
  readonly users = new Map<string, UserWithProfile>();

  add(user: UserWithProfile): void {
    this.users.set(user.id, structuredClone(user));
  }

  findUserWithProfile(userId: string): Promise<UserWithProfile | null> {
    const user = this.users.get(userId);
    return Promise.resolve(user ? structuredClone(user) : null);
  }

  upsertProfile(
    userId: string,
    data: { yearOfStudy?: YearOfStudy },
  ): Promise<void> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`No user ${userId}`);
    user.studentProfile = {
      yearOfStudy: null,
      onboardingCompletedAt: null,
      university: null,
      major: null,
      _count: { documents: 0 },
      ...user.studentProfile,
      ...data,
    };
    return Promise.resolve();
  }

  completeOnboarding(userId: string): Promise<void> {
    const profile = this.users.get(userId)?.studentProfile;
    if (!profile) throw new Error(`No profile for ${userId}`);
    profile.onboardingCompletedAt = new Date();
    return Promise.resolve();
  }
}
