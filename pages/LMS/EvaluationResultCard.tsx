/**
 * pages/LMS/EvaluationResultCard — the Chief Architect's evaluation result.
 *
 * Extracted from `LessonModal` so the practical-challenge verdict is a
 * self-contained presentational unit: it owns the grade badge (color by
 * threshold), the feedback summary and the improvement list. It renders only
 * when an evaluation exists — the caller decides when that is.
 */
import type { ChallengeEvaluation } from '../../services/ai';

interface EvaluationResultCardProps {
  evaluation: ChallengeEvaluation;
}

const gradeColor = (grade: number): string => {
  if (grade >= 80) return 'text-green-600';
  if (grade >= 60) return 'text-amber-500';
  return 'text-red-500';
};

export const EvaluationResultCard: React.FC<EvaluationResultCardProps> = ({ evaluation }) => {
  const grade = evaluation.grade ?? 0;
  return (
    <div className="mt-8 p-6 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Evaluación del Chief Architect</h4>
        <span className={`text-2xl font-black ${gradeColor(grade)}`}>
          {grade}/100
        </span>
      </div>
      <p className="text-indigo-800 dark:text-indigo-200 mb-4">{evaluation.feedback}</p>
      <h5 className="font-bold text-indigo-900 dark:text-indigo-100 mb-2">Puntos de Mejora:</h5>
      <ul className="list-disc pl-5 text-indigo-800 dark:text-indigo-200 space-y-1">
        {evaluation.improvements?.map((imp: string, i: number) => <li key={i}>{imp}</li>)}
      </ul>
    </div>
  );
};