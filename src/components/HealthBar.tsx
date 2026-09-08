/** Colour lives in CSS so the bar can animate its drain and pulse when critical. */
export default function HealthBar({ hp, maxHp, name }: { hp: number; maxHp: number; name: string }) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  const tone = ratio > 0.5 ? 'hp-high' : ratio > 0.2 ? 'hp-mid' : 'hp-low';
  return <div className={`health-track ${tone}`} role="progressbar" aria-label={`${name} HP`}
    aria-valuenow={hp} aria-valuemin={0} aria-valuemax={maxHp}>
    <span className="health-fill" style={{ width: `${ratio * 100}%` }} />
  </div>;
}
