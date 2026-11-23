import sys, json, math
from segs import segs
from collections import defaultdict

def comps(S, tol=0.35):
    # union-find on endpoints
    par=list(range(len(S)))
    def f(i):
        while par[i]!=i: par[i]=par[par[i]]; i=par[i]
        return i
    grid=defaultdict(list)
    for i,(a,b) in enumerate(S):
        for p in (a,b):
            grid[(round(p[0]/tol),round(p[1]/tol))].append(i)
    for (gx,gy),L in list(grid.items()):
        cand=[]
        for dx in (-1,0,1):
            for dy in (-1,0,1): cand+=grid.get((gx+dx,gy+dy),[])
        for j in cand: 
            ri,rj=f(L[0]),f(j)
            if ri!=rj: par[ri]=rj
    # also segment crossing/touching mid: approximate by sampling points along long segs
    G=defaultdict(list)
    for i,s in enumerate(S): G[f(i)].append(i)
    return list(G.values())

def bbox(S,idx):
    xs=[p[0] for i in idx for p in S[i]]; ys=[p[1] for i in idx for p in S[i]]
    return min(xs),min(ys),max(xs),max(ys)

def merge_axis(S, horiz, minlen):
    # returns list of (c, a0, a1) merged colinear axis-aligned lines
    by=defaultdict(list)
    for a,b in S:
        if horiz and abs(a[1]-b[1])<0.06: by[round((a[1]+b[1])/2,1)].append(tuple(sorted((a[0],b[0]))))
        if not horiz and abs(a[0]-b[0])<0.06: by[round((a[0]+b[0])/2,1)].append(tuple(sorted((a[1],b[1]))))
    out=[]
    for c,iv in by.items():
        iv.sort(); cur=list(iv[0])
        for s,e in iv[1:]:
            if s<=cur[1]+0.15: cur[1]=max(cur[1],e)
            else: out.append((c,cur[0],cur[1])); cur=[s,e]
        out.append((c,cur[0],cur[1]))
    return [o for o in out if o[2]-o[1]>=minlen]

def walls(lines, tmin, tmax, minov):
    # pair parallel lines; wall = overlap region if no third line between
    lines=sorted(lines)
    res=[]
    for i,(c1,a1,b1) in enumerate(lines):
        for c2,a2,b2 in lines[i+1:]:
            d=c2-c1
            if d<tmin: continue
            if d>tmax: break
            lo,hi=max(a1,a2),min(b1,b2)
            if hi-lo<minov: continue
            # split by any line strictly between covering parts
            pieces=[(lo,hi)]
            for c3,a3,b3 in lines:
                if c1+0.05<c3<c2-0.05:
                    np=[]
                    for s,e in pieces:
                        if b3<=s or a3>=e: np.append((s,e)); continue
                        if a3>s: np.append((s,a3))
                        if b3<e: np.append((b3,e))
                    pieces=np
            for s,e in pieces:
                if e-s>=minov: res.append((c1,c2,s,e))
    return res
