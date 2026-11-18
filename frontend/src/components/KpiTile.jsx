import { Box, Paper, Typography } from '@mui/material';
import { colors } from '../theme';

export default function KpiTile({ icon, label, value, hint, accent = colors.cyan }) {
  return (
    <Paper sx={{ p: 2.25, height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accent}14, transparent 60%)`, pointerEvents: 'none' }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: `${accent}22`, color: accent }}>{icon}</Box>
        <Typography variant="subtitle2">{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>{value}</Typography>
      {hint && <Typography variant="caption" sx={{ color: colors.faint }}>{hint}</Typography>}
    </Paper>
  );
}
