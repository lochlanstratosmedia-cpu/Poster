from gen import *
from labels import LABELS
OFF={'u12L':(0,0),'u12U':(480,0),'u345L':(0,520),'u345U':(600,520)}
CAP={'u12L':'Lower floor','u12U':'Upper floor','u345L':'Lower floor','u345U':'Upper floor'}
out=[]
allx=[];ally=[]
for f in ['u12L','u12U','u345L','u345U']:
    W,L,F=plan_parts(f)
    hx=HOUSE[f]; ox,oy=OFF[f]; dx,dy=ox-hx[0],oy-hx[1]
    P=lambda p:(round(p[0]+dx,3),round(p[1]+dy,3))
    g=[f'<g id="{f}">']
    d=' '.join(f'M{P(a)[0]} {P(a)[1]}L{P(b)[0]} {P(b)[1]}' for a,b in L)
    g.append(f'<path d="{d}" fill="none" stroke="#000000" stroke-width="0.3" stroke-linecap="round"/>')
    for r in W:
        a=P(r[:2]); b=P(r[2:])
        g.append(f'<polygon points="{a[0]},{a[1]} {b[0]},{a[1]} {b[0]},{b[1]} {a[0]},{b[1]}" fill="#000000" stroke="#000000" stroke-width="0.15"/>')
    for pts in F:
        if len(pts)>=3: g.append('<polygon points="'+' '.join(f'{P(p)[0]},{P(p)[1]}' for p in pts)+'" fill="#000000"/>')
    for n,x,y,ms in LABELS[f]:
        X,Y=P((x,y))
        if ms=='UNIT':
            g.append(f'<text x="{X}" y="{Y+1.5}" font-family="Arial" font-size="5" text-anchor="middle">{n}</text>'); continue
        g.append(f'<text x="{X}" y="{Y+1.5}" font-family="Arial" font-size="4.6" text-anchor="middle">{n}</text>')
        if ms: g.append(f'<text x="{X}" y="{Y+7.5}" font-family="Arial" font-size="4.6" text-anchor="middle">{ms}</text>')
    # caption below the level
    cx=ox+(hx[2]-hx[0])/2; cy=oy+(hx[3]-hx[1])+(48 if f in('u12L','u12U','u345U') else 12)
    g.append(f'<text x="{cx}" y="{cy}" font-family="Arial" font-size="6">{CAP[f]}</text>')
    g.append('</g>')
    out+=g
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="-20 -20 1140 1000" width="1140" height="1000">'+''.join(out)+'</svg>'
open('161-main-rd-traced.svg','w').write(svg)
print(len(svg))
