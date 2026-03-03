interface ActivityChartProps {
  hourlyActivity: number[];
}

const ActivityChart = ({ hourlyActivity }: ActivityChartProps) => {
  const max = Math.max(...hourlyActivity, 1);

  return (
    <div className="neon-card rounded-xl p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        24h Activity Map
      </h3>
      <div className="flex items-end gap-1 h-32">
        {hourlyActivity.map((count, i) => {
          const height = (count / max) * 100;
          const opacity = count === 0 ? 0.1 : 0.3 + (count / max) * 0.7;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
              <div
                className="w-full rounded-sm bg-primary transition-all duration-300 group-hover:bg-neon-cyan min-h-[2px]"
                style={{ height: `${Math.max(height, 2)}%`, opacity }}
              />
              {i % 6 === 0 && (
                <span className="text-[10px] text-muted-foreground font-mono">{i}h</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityChart;
