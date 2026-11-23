import fitz, json, sys
def segs(f):
    p=fitz.open(f'../pdf/{f}.pdf')[0]; out=[]
    for x in p.get_drawings():
        w=round(x.get('width') or 0,2); col=x.get('color'); fill=x.get('fill'); dash=x.get('dashes')
        key=f"{x['type']}|{w}|{col and round(col[0],2)}|{fill and round(fill[0],2)}|{dash}"
        for it in x['items']:
            if it[0]=='l': pts=[it[1],it[2]]
            elif it[0]=='re': r=it[1]; pts=[r.tl,r.tr,r.br,r.bl,r.tl]
            elif it[0]=='qu': q=it[1]; pts=[q.ul,q.ur,q.lr,q.ll,q.ul]
            elif it[0]=='c': pts=[it[1],it[4]]
            else: continue
            for a,b in zip(pts,pts[1:]):
                # view coords: X=py, Y=842-px
                out.append((key,(a.y,842-a.x),(b.y,842-b.x)))
    return out
if __name__=='__main__':
    for f in ['u12L','u12U','u345L','u345U']:
        s=segs(f); from collections import Counter
        print(f,Counter(k for k,_,_ in s))
