import { Box, Paper, Typography } from '@mui/material';

export default function Section({ title, subtitle, action, children, sx }) {
  return (
    <Paper sx={{ p: 2.25, ...sx }}>
      {(title || action) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.75 }}>
          <Box>
            <Typography variant="h6" sx={{ fontSize: 16 }}>{title}</Typography>
            {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
          </Box>
          {action}
        </Box>
      )}
      {children}
    </Paper>
  );
}
