def m(a,b): 
    r=lambda v: f"{int(v/100+0.5)/10:.1f}"
    return f"{r(a)} m x {r(b)} m"
def mirror(L, M):
    return [(n,M-x,y,ms) for n,x,y,ms in L]
def shift(L, d):
    return [(n,x+d,y,ms) for n,x,y,ms in L]
u1L=[('Garage',486.8,280.2,m(5500,5980)),('Dining / Living',485.4,474.8,m(3600,5980)),
     ('Bath',437,374,None),('Unit 1',484.2,313.7,'UNIT')]
u2L=mirror(u1L,1147.5); u2L=[(('Unit 2' if n=='Unit 1' else n),x,y,ms) for n,x,y,ms in u2L]
u1U=[('Bed 1',537.2,440.8,m(3880,3500)),('Bed 2',461.0,235.1,m(3000,2950)),('Bed 3',548.5,235.1,m(3000,2960)),
     ('Balcony',506.4,528.6,None),('Bath',535,372,None),('Ensuite',445,487,None)]
u2U=[('Bed 1',657.0,440.8,m(3880,3500)),('Bed 2',731.6,235.1,m(3000,2950)),('Bed 3',644.0,235.1,m(3000,2960)),
     ('Balcony',685.6,528.6,None),('Bath',1192.9-535,372,None),('Ensuite',1192.9-445,487,None)]
u3L=[('Living',456.1,229.7,m(5280,3600)),('Dining',420.2,298.7,m(2980,2400)),('Kitchen',487.4,345.8,m(3200,2400)),
     ('Garage',478.4,398.7,m(3200,5500)),('Unit 3',493.1,456.8,'UNIT')]
u4L=shift(u3L,162.4); u4L=[(('Unit 4' if n=='Unit 3' else n),x,y,ms) for n,x,y,ms in u4L]
u5L=mirror(u3L,1245.4); u5L=[(('Unit 5' if n=='Unit 3' else n),x,y,ms) for n,x,y,ms in u5L]
u3U=[('Study',380.0,279.4,m(2210,3600)),('Bed 2',470.0,279.5,m(3000,3000)),('Bed 1',464.1,458.6,m(3400,3400)),
     ('Bath',476,397,None),('Ensuite',383,493,None)]
u4U=shift(u3U,162.4)+[('Balcony',593.9,542.6,None)]
u5U=mirror(u3U,1191.7)
LABELS={'u12L':u1L+u2L,'u12U':u1U+u2U,'u345L':u3L+u4L+u5L,'u345U':u3U+u4U+u5U}
