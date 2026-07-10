const PROGRESS_STEPS = [0, 25, 50, 75, 100]

interface ProgressStepsProps {
  /** Current progress 0-100 */
  current: number
  /** When true, the steps render as fully done (100%) */
  completed: boolean
  onChange: (progress: number) => void
}

/** 5-step progress selector (0/25/50/75/100%) reused by the priority panel and task editor. */
export default function ProgressSteps({
  current,
  completed,
  onChange
}: ProgressStepsProps): JSX.Element {
  const display = completed ? 100 : current
  return (
    <div className="priority-progress">
      <span className="priority-progress__label">进度 {display}%</span>
      {PROGRESS_STEPS.map((step) => {
        // Step 0 is never "filled"; steps > 0 fill up to the current level.
        const isFilled = step > 0 && step <= display
        const isDone = step === 100 && display === 100
        return (
          <button
            key={step}
            type="button"
            className={`progress-step ${isFilled ? 'progress-step--filled' : ''} ${isDone ? 'progress-step--done' : ''}`}
            title={`${step}%`}
            onClick={() => onChange(step)}
          >
            {step === 0 ? '0' : step === 100 ? '✓' : ''}
          </button>
        )
      })}
    </div>
  )
}
