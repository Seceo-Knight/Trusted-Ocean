import { createTheme } from '@mui/material/styles';

// Same visual language as the SeceoKnight SIEM: deep navy, cyan accent, rounded cards.
export const colors = {
  bg: '#0a0f1a',
  paper: '#141b2d',
  elevated: '#1e293b',
  border: 'rgba(148, 163, 184, 0.12)',
  text: '#f1f5f9',
  muted: '#94a3b8',
  faint: '#64748b',
  cyan: '#06b6d4',
  cyanLight: '#22d3ee',
  purple: '#8b5cf6',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
  ocean: '#0b1626',
  land: '#1f2b42',
  coast: '#3a4d6e',
};

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: colors.cyan, light: colors.cyanLight, dark: '#0891b2', contrastText: '#fff' },
    secondary: { main: colors.purple },
    success: { main: colors.green },
    warning: { main: colors.amber },
    error: { main: colors.red },
    info: { main: colors.blue },
    background: { default: colors.bg, paper: colors.paper },
    text: { primary: colors.text, secondary: colors.muted, disabled: colors.faint },
    divider: colors.border,
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 600 },
    subtitle2: { color: colors.muted, fontWeight: 500 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: colors.bg, scrollbarColor: '#334155 #0f172a' },
        '*::-webkit-scrollbar': { width: 8, height: 8 },
        '*::-webkit-scrollbar-thumb': { background: '#334155', borderRadius: 4 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', border: `1px solid ${colors.border}` },
      },
    },
    MuiTableCell: { styleOverrides: { root: { borderColor: colors.border } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: colors.elevated, fontSize: 12 } } },
  },
});
