import math, json, sys
from segs import segs
from trace import comps, bbox, merge_axis, walls
import fitz

HOUSE={'u12L':(392.2,193.0,755.2,537.2),'u12U':(415.0,194.7,777.8,507.6),'u345L':(381.4,202.7,865.0,546.6),'u345U':(353.5,229.5,838.7,519.5)}
EXTRA={'u12L':[(510,535,640,570)],'u12U':[(410,505,782,548)],'u345L':[],'u345U':[(509,517,683,566)]}
ERASE={k:[] for k in HOUSE}
try:
    ERASE.update(json.load(open('erase.json')))
except FileNotFoundError: pass

def inside(p,r,t=0): return r[0]-t<=p[0]<=r[2]+t and r[1]-t<=p[1]<=r[3]+t
def keep_pt(f,p):
    return inside(p,HOUSE[f],3.0) or any(inside(p,r) for r in EXTRA[f])
def erased(f,a,b):
    return any(inside(a,r,1.5) and inside(b,r,1.5) for r in ERASE[f])

def is_tick(s, axis_lines):
    (a,b)=s; dx=b[0]-a[0]; dy=b[1]-a[1]; L=math.hypot(dx,dy)
    if not (0.8<L<4.5) or abs(abs(dx)-abs(dy))>0.25*L: return False
    m=((a[0]+b[0])/2,(a[1]+b[1])/2)
    for o,c,s0,s1 in axis_lines:
        if o=='h' and abs(m[1]-c)<0.35 and s0-0.5<=m[0]<=s1+0.5: return True
        if o=='v' and abs(m[0]-c)<0.35 and s0-0.5<=m[1]<=s1+0.5: return True
    return False

def clean(f, L):
    L=[s for s in L if keep_pt(f,s[0]) and keep_pt(f,s[1]) and not erased(f,*s)]
    keep=[]; lone=[]
    axis=[('h',)+x for x in merge_axis(L,True,3)]+[('v',)+x for x in merge_axis(L,False,3)]
    for c in comps(L):
        x0,y0,x1,y1=bbox(L,c)
        md=max(x1-x0,y1-y0)
        longest=max(math.dist(*L[i]) for i in c)
        if md<6: continue                      # glyphs, DP circles, floor wastes
        if md<9 and longest<2.2: continue      # smoke alarm circles etc
        if any(is_tick(L[i],axis) for i in c) : continue  # dimension lines
        if len(c)==1 and math.dist(*L[c[0]])<100: lone.append(L[c[0]]); continue
        keep+=[L[i] for i in c]
    # lone lines survive only as part of an evenly spaced set (stair treads)
    def dirn(s):
        (a,b)=s; L_=math.dist(a,b); return ((b[0]-a[0])/L_,(b[1]-a[1])/L_),L_
    for s in lone:
        d,l=dirn(s); m=((s[0][0]+s[1][0])/2,(s[0][1]+s[1][1])/2); n=0
        for t in lone:
            if t is s: continue
            e,k=dirn(t)
            if abs(abs(d[0]*e[0]+d[1]*e[1])-1)>0.002 or abs(k-l)>1.5: continue
            mt=((t[0][0]+t[1][0])/2,(t[0][1]+t[1][1])/2)
            along=abs((mt[0]-m[0])*d[0]+(mt[1]-m[1])*d[1]); perp=abs(-(mt[0]-m[0])*d[1]+(mt[1]-m[1])*d[0])
            if along<1.5 and 1<perp<12: n+=1
        # or a wall face: an axis line with a parallel line 1.8-4.1 away alongside it
        if n==0 and (abs(d[0])>0.999 or abs(d[1])>0.999):
            hz=abs(d[0])>0.999; c=m[1] if hz else m[0]
            lo_,hi_=(min(s[0][0],s[1][0]),max(s[0][0],s[1][0])) if hz else (min(s[0][1],s[1][1]),max(s[0][1],s[1][1]))
            for o,cc,a0,a1 in axis:
                if (o=='h')==hz and 1.8<=abs(cc-c)<=4.1 and min(a1,hi_)-max(a0,lo_)>0.6*(hi_-lo_): n=1; break
        if n>=1: keep.append(s)
    return keep

ADD={'u345L':[(862.3,205.3,865.0,363.2)]}
def detect_walls(f, L23c, L48c):
    H=merge_axis(L23c,True,3); V=merge_axis(L23c,False,3)
    W=[('h',)+w for w in walls(H,1.85,3.3,1.0)]+[('v',)+w for w in walls(V,1.85,3.3,1.0)]
    # cuts: 0.48 frames along walls, and thin 0.23 frame pairs (windows)
    cuts={'h':[],'v':[]}
    for o,ls in (('h',merge_axis(L48c,True,10)),('v',merge_axis(L48c,False,10))):
        for c1,c2,s,e in walls(sorted(ls),0.4,2.6,12):
            if e-s<90: cuts[o].append(((c1+c2)/2,s,e))
    for o,ls in (('h',H),('v',V)):
        for c1,c2,s,e in walls(ls,0.85,1.8,12):
            if e-s<75: cuts[o].append(((c1+c2)/2,s,e))
    out=[]
    for o,c1,c2,s,e in W:
        pieces=[(s,e)]
        for c,a,b in cuts[o]:
            if abs(c-(c1+c2)/2)>4.6: continue
            if c1-0.05<=c<=c2+0.05 and False: pass
            np=[]
            for p,q in pieces:
                if b<=p or a>=q: np.append((p,q)); continue
                if a>p: np.append((p,a))
                if b<q: np.append((b,q))
            pieces=np
        out+=[(o,c1,c2,p,q) for p,q in pieces if q-p>0.8]
    # only house walls
    hx=HOUSE[f]
    def rect(w):
        o,c1,c2,p,q=w
        return (p,c1,q,c2) if o=='h' else (c1,p,c2,q)
    def clip(w):
        o,c1,c2,p,q=w
        if o=='h':
            if not (hx[1]-2<=c1 and c2<=hx[3]+2): return None
            p,q=max(p,hx[0]-1),min(q,hx[2]+1)
        else:
            if not (hx[0]-2<=c1 and c2<=hx[2]+2): return None
            p,q=max(p,hx[1]-1),min(q,hx[3]+1)
        return (o,c1,c2,p,q) if q-p>0.8 else None
    out=[w for w in map(clip,out) if w]
    # fill narrow gaps between parallel walls (party walls)
    extra=[]
    for i,a in enumerate(out):
        for b in out[i+1:]:
            if a[0]!=b[0]: continue
            lo,hi=sorted([a,b],key=lambda w:w[1])
            gap=hi[1]-lo[2]
            if 0<gap<=2.0:
                s,e=max(lo[3],hi[3]),min(lo[4],hi[4])
                if e-s>10: extra.append((a[0],lo[2],hi[1],s,e))
    return [rect(w) for w in out+extra]+ADD.get(f,[])

def fills(f):
    p=fitz.open(f'../pdf/{f}.pdf')[0]; out=[]
    for d in p.get_drawings():
        if d['type']!='f' or not d.get('fill') or d['fill'][0]>0.1: continue
        r=d['rect']; R=(r.y0,842-r.x1,r.y1,842-r.x0)
        if max(R[2]-R[0],R[3]-R[1])<4.5: continue
        if not (keep_pt(f,(R[0],R[1])) and keep_pt(f,(R[2],R[3]))): continue
        pts=[]
        for it in d['items']:
            if it[0]=='l': pts+= [it[1],it[2]]
            elif it[0]=='re': pts+= [it[1].tl,it[1].tr,it[1].br,it[1].bl]
            elif it[0]=='qu': q=it[1]; pts+=[q.ul,q.ur,q.lr,q.ll]
        out.append([(pt.y,842-pt.x) for pt in pts])
    return out

def plan_parts(f):
    allS=segs(f)
    L23=[(a,b) for k,a,b in allS if k.startswith('s|0.23')]
    L48=[(a,b) for k,a,b in allS if k.startswith('s|0.48')]
    L23c=clean(f,L23); L48c=clean(f,L48)
    W=detect_walls(f,L23c,L48c)
    return W, L23c+L48c, fills(f)
