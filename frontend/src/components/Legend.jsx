import { Box, Typography } from '@mui/material';

export function RampLegend({ ramp, unit }) {
  const grad = `linear-gradient(90deg, ${ramp.map(([, c], i) => `${c} ${(i / (ramp.length - 1)) * 100}%`).join(', ')})`;
  return (
    <Box sx={{ minWidth: 220 }}>
      <Box sx={{ height: 8, borderRadius: 4, background: grad }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{ramp[0][0]} {unit}</Typography>
        <Typography variant="caption" color="text.secondary">{ramp[ramp.length - 1][0]} {unit}</Typography>
      </Box>
    </Box>
  );
}

export function DotLegend({ items }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
      {items.map(([label, color]) => (
        <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
      ))}
    </Box>
  );
}
