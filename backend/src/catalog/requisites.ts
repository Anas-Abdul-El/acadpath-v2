import { CourseRelationType } from '../generated/prisma/enums.js';

export interface RequisiteRow {
  courseId: string;
  requiredCourseId: string;
  relationType: CourseRelationType;
}

/**
 * Turns the course codes the AI listed as prerequisites/corequisites into rows linking
 * saved course ids (v1: inline in saveMajorData). Codes that aren't saved courses of
 * this major, and a course listing itself, are dropped instead of guessed.
 */
export function buildRequisites(
  courses: { code: string; prerequisites: string[]; corequisites: string[] }[],
  idByCode: Map<string, string>,
): RequisiteRow[] {
  return courses.flatMap((course) => {
    const courseId = idByCode.get(course.code);
    if (!courseId) return [];

    return [
      ...course.prerequisites.map((code) => ({
        code,
        relationType: CourseRelationType.PREREQUISITE,
      })),
      ...course.corequisites.map((code) => ({
        code,
        relationType: CourseRelationType.COREQUISITE,
      })),
    ].flatMap(({ code, relationType }) => {
      const requiredCourseId = idByCode.get(code);
      if (!requiredCourseId || requiredCourseId === courseId) return [];
      return [{ courseId, requiredCourseId, relationType }];
    });
  });
}
