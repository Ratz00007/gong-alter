"""Figure 3 — estimated cost per processed 30-minute call (USD).

Follows typesetting/charts.md: horizontal bars (long category names), top/right
spines deleted, no grid (values are labeled on bars), no internal title (the PDF
caption identifies the figure). Palette: cascade warmth/seed13 family + one
muted semantic red for the Gong bar.
"""
import matplotlib
import matplotlib.font_manager as fm

fm.fontManager.addfont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')

import matplotlib.pyplot as plt

plt.rcParams['font.sans-serif'] = ['DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

ROWS = [
    ('Gong seat (amortized, incl. platform fee)', 13.20, '#a34941', '$13.20'),
    ('All-cloud premium chain',                    0.24, '#7b5541', '$0.24'),
    ('All-cloud budget chain',                     0.20, '#cd6e4e', '$0.20'),
    ('Hybrid: local STT + cloud analysis',         0.04, '#d76932', '$0.04'),
    ('Fully local',                                0.01, '#58463d', '\u2248 $0.01'),
]

labels = [r[0] for r in ROWS]
values = [r[1] for r in ROWS]
colors = [r[2] for r in ROWS]
texts  = [r[3] for r in ROWS]

fig, ax = plt.subplots(figsize=(7.6, 3.1), dpi=200, constrained_layout=True)

y = range(len(ROWS))
bars = ax.barh(y, values, height=0.62, color=colors, edgecolor='none')
ax.invert_yaxis()

for i, (bar, txt) in enumerate(zip(bars, texts)):
    ax.text(bar.get_width() + 0.18, bar.get_y() + bar.get_height() / 2, txt,
            va='center', ha='left', fontsize=11, fontweight='bold', color='#22201f')

ax.set_yticks(list(y))
ax.set_yticklabels(labels, fontsize=11.5, color='#22201f')
ax.set_xlabel('USD per processed 30-minute call \u2014 list-price estimates, Oct 2026 (verify at build time)',
              fontsize=10.5, color='#89827f')
ax.set_xlim(0, 15.2)

ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_visible(False)
ax.spines['bottom'].set_color('#c1aea4')
ax.spines['bottom'].set_linewidth(1.0)
ax.tick_params(axis='x', colors='#89827f', labelsize=10.5, length=3)
ax.tick_params(axis='y', colors='#22201f', length=0)
ax.grid(False)

fig.savefig('/home/z/my-project/scripts/amber/fig3_cost.png', facecolor='white')
print('saved fig3_cost.png')
