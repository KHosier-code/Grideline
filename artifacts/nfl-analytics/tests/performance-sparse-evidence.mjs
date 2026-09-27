// Mirror the visible chart gates without treating other matchup metrics or
// quote summaries as evidence that a plot can be drawn.
const comparisonSpecs = {
  passing: 'Blended pass EPA / dropback',
  rushing: 'Blended rush EPA / carry',
  red_zone: 'Offensive red-zone rate',
  pace_tendency: 'Seconds per play',
};

export function isSparseGameDetail(detail) {
  if (!detail || detail.prediction || !Array.isArray(detail.matchupBoard?.assessments)
    || !Array.isArray(detail.movement?.streams)) return false;
  const comparisonAvailable = Object.entries(comparisonSpecs).some(([category, label]) => {
      const assessment = detail.matchupBoard.assessments?.find(item => item.category === category);
      const metric = assessment?.metrics?.find(item => item.label === label);
      return assessment && assessment.edge !== 'insufficient' && assessment.confidence !== 'unavailable'
        && Number.isFinite(metric?.homeValue) && Number.isFinite(metric?.awayValue);
    });
  const movementAvailable = detail.movement.streams?.some(stream => stream.observations?.length > 0);
  return !comparisonAvailable && !movementAvailable;
}