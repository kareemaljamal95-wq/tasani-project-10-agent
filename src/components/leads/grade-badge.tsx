import { gradeFor, type LeadGrade } from '@/lib/lead-scoring';

/**
 * The A/B/C badge.
 *
 * Takes a score and derives the grade here rather than accepting a grade
 * prop, so a caller cannot render a letter that disagrees with the number
 * beside it.
 */

const GRADE_STYLE: Record<LeadGrade, string> = {
  A: 'bg-green-500/15 text-green-300 border-green-500/30',
  B: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  C: 'bg-white/10 text-white/50 border-white/20',
};

export const GRADE_LABEL: Record<LeadGrade, string> = {
  A: 'فرصة قوية',
  B: 'فرصة متوسطة',
  C: 'فرصة ضعيفة',
};

export function GradeBadge({
  score,
  showScore = true,
}: {
  score: number;
  showScore?: boolean;
}) {
  const grade = gradeFor(score);

  return (
    <span
      title={`${GRADE_LABEL[grade]} — ${score}/100`}
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${GRADE_STYLE[grade]}`}
    >
      {grade}
      {showScore ? ` · ${score}` : ''}
    </span>
  );
}
