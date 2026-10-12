import sys
OUT=sys.argv[1]
HEAD='''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,300..900&display=block" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#777;display:flex;flex-wrap:wrap;gap:40px;padding:40px;align-items:flex-start}
.ad{position:relative;overflow:hidden;font-family:Inter,sans-serif;font-optical-sizing:auto;-webkit-font-smoothing:antialiased;color:#fff}
.s{width:1080px;height:1920px}.b{width:1200px;height:628px}
.bg,.bg img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bw{filter:grayscale(1) contrast(1.05) brightness(.92)}
.tint{position:absolute;inset:0;background:linear-gradient(170deg,rgba(57,43,61,.62) 0%,rgba(57,43,61,.25) 45%,rgba(40,28,46,.55) 100%)}
.tintc{position:absolute;inset:0;background:linear-gradient(170deg,rgba(57,43,61,.45) 0%,rgba(57,43,61,.05) 45%,rgba(40,28,46,.4) 100%)}
.orb{position:absolute;border-radius:50%;filter:blur(60px)}
.g{position:absolute;overflow:hidden;
 background:linear-gradient(145deg,rgba(255,255,255,.30) 0%,rgba(255,255,255,.10) 45%,rgba(255,255,255,.18) 100%);
 -webkit-backdrop-filter:blur(34px) saturate(190%) brightness(1.05);backdrop-filter:blur(34px) saturate(190%) brightness(1.05);
 box-shadow:inset 0 2px 1px rgba(255,255,255,.75),inset 0 -2px 2px rgba(255,255,255,.18),inset 2px 0 1px rgba(255,255,255,.25),inset -2px 0 1px rgba(255,255,255,.12),0 40px 80px rgba(0,0,0,.28)}
.b .g{box-shadow:inset 0 1.5px 1px rgba(255,255,255,.75),inset 0 -1px 1px rgba(255,255,255,.18),0 20px 40px rgba(0,0,0,.28);-webkit-backdrop-filter:blur(22px) saturate(190%);backdrop-filter:blur(22px) saturate(190%)}
.g::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(120% 60% at 20% -10%,rgba(255,255,255,.45) 0%,rgba(255,255,255,0) 45%),radial-gradient(80% 40% at 100% 110%,rgba(255,255,255,.18) 0%,rgba(255,255,255,0) 60%)}
.g::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;padding:2px;background:linear-gradient(160deg,rgba(255,255,255,.9),rgba(255,255,255,.1) 35%,rgba(255,255,255,.05) 65%,rgba(255,255,255,.6));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.g.t{background:linear-gradient(145deg,rgba(194,173,224,.58) 0%,rgba(123,92,168,.38) 60%,rgba(194,173,224,.48) 100%)}
.g.d{background:linear-gradient(145deg,rgba(30,22,34,.5) 0%,rgba(30,22,34,.3) 100%)}
.g.rel{position:relative}
.in{position:relative;z-index:1}
.ts{text-shadow:0 2px 24px rgba(0,0,0,.25)}
.hv{font-weight:800;letter-spacing:-.05em;line-height:.95}
.hd{font-weight:700;letter-spacing:-.035em;line-height:1.04}
.lb{font-weight:600;opacity:.9}
.mut{font-weight:500;opacity:.8}
.cta{display:flex;align-items:center;justify-content:space-between}
.cta .ar{border-radius:50%;background:rgba(255,255,255,.92);display:grid;place-items:center}
.ph{height:16px;border-radius:8px;background:rgba(255,255,255,.35)}
.chev{display:inline-block;width:.42em;height:.42em;border-right:.1em solid currentColor;border-top:.1em solid currentColor;transform:rotate(45deg)}
</style></head><body>
'''
ARW='<svg viewBox="0 0 24 24" fill="none" stroke="#392B3D" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="width:46%;height:46%"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
PIN='<svg viewBox="0 0 100 130" style="width:{w}px"><path d="M50 4C25 4 6 23 6 47c0 32 44 79 44 79s44-47 44-79C94 23 75 4 50 4z" fill="#C2ADE0"/><circle cx="50" cy="46" r="17" fill="#fff"/></svg>'
HOUSE='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:55%;height:55%"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>'
UP='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="width:55%;height:55%"><path d="M7 17L17 7M9 7h8v8"/></svg>'

def bg(photo,pos,colour=False):
    cls='' if colour else ' class="bw"'
    t='tintc' if colour else 'tint'
    return f'<div class="bg"><img src="photos/{photo}" style="object-position:{pos}"{cls}></div><div class="{t}"></div>'
def orbs(size):
    if size=='s':
        return '<div class="orb" style="left:-160px;top:520px;width:640px;height:640px;background:rgba(194,173,224,.55)"></div><div class="orb" style="right:-200px;top:1120px;width:700px;height:700px;background:rgba(123,92,168,.5)"></div>'
    return '<div class="orb" style="left:520px;top:-120px;width:420px;height:420px;background:rgba(194,173,224,.5)"></div><div class="orb" style="right:-120px;top:300px;width:440px;height:440px;background:rgba(123,92,168,.45)"></div>'
def cta_s(top=1336):
    return f'''<div class="g t" style="left:60px;right:60px;top:{top}px;height:140px;border-radius:999px"><div class="in cta" style="height:100%;padding:0 22px 0 60px"><span class="ts" style="font-size:40px;font-weight:600;letter-spacing:-.015em">Book a Chat. <span class="mut">No Cost. No Commitment.</span></span><span class="ar" style="width:100px;height:100px">{ARW}</span></div></div>'''
def cta_b(left,top,width):
    return f'''<div class="g t" style="left:{left}px;top:{top}px;width:{width}px;height:76px;border-radius:999px"><div class="in cta" style="height:100%;padding:0 12px 0 30px"><span class="ts" style="font-size:22px;font-weight:600;letter-spacing:-.01em">Book a Chat. <span class="mut">No Cost. No Commitment.</span></span><span class="ar" style="width:54px;height:54px">{ARW}</span></div></div>'''

ADS=[]
def ad(slug): 
    def deco(fn): ADS.append((slug,fn)); return fn
    return deco

# 01 Maps style: search pill + bottom sheet
@ad('01-2287-home-sits')
def a01(size):
    if size=='s':
        return bg('house-colour.jpg','48% 50%',True)+f'''
<div class="g" style="left:60px;right:60px;top:250px;height:130px;border-radius:999px"><div class="in" style="display:flex;align-items:center;gap:26px;height:100%;padding:0 46px">{PIN.format(w=48)}<span class="ts lb" style="font-size:44px">Postcode 2287</span></div></div>
<div class="g" style="left:40px;right:40px;top:760px;height:540px;border-radius:72px"><div class="in" style="padding:40px 64px">
<div style="width:120px;height:10px;border-radius:5px;background:rgba(255,255,255,.55);margin:0 auto 34px"></div>
<div class="ts hv" style="font-size:250px">2287</div>
<div class="ts hd" style="font-size:78px;margin-top:20px">Find out where<br>your home sits.</div></div></div>'''+cta_s()
    return bg('house-colour.jpg','48% 50%',True)+f'''
<div class="g" style="left:40px;top:40px;width:330px;height:70px;border-radius:999px"><div class="in" style="display:flex;align-items:center;gap:14px;height:100%;padding:0 26px">{PIN.format(w=26)}<span class="ts lb" style="font-size:24px">Postcode 2287</span></div></div>
<div class="g" style="left:620px;top:40px;width:540px;height:548px;border-radius:44px"><div class="in" style="padding:30px 40px">
<div style="width:70px;height:6px;border-radius:3px;background:rgba(255,255,255,.55);margin:0 auto 18px"></div>
<div class="ts hv" style="font-size:170px">2287</div>
<div class="ts hd" style="font-size:50px;margin-top:12px">Find out where your home sits.</div></div></div>'''+cta_b(630,494,520)

# 02 widgets 2284
@ad('02-2284-home-sits')
def a02(size):
    if size=='s':
        return bg('kitchen.jpg','55% 50%')+orbs('s')+f'''
<div class="g" style="left:70px;right:70px;top:250px;height:560px;border-radius:76px"><div class="in" style="padding:60px 70px"><div style="display:flex;align-items:center;gap:20px">{PIN.format(w=44)}<span class="ts lb" style="font-size:38px">Postcode</span></div><div class="ts hv" style="font-size:340px;margin-top:14px">2284</div></div></div>
<div class="g d" style="left:70px;right:70px;top:840px;height:360px;border-radius:76px"><div class="in ts hd" style="padding:64px 70px;font-size:92px">Find out where <span style="color:#D9C8F0">your home</span> sits.</div></div>'''+cta_s(1260)
    return bg('kitchen.jpg','55% 50%')+orbs('b')+f'''
<div class="g" style="left:40px;top:40px;width:520px;height:300px;border-radius:44px"><div class="in" style="padding:30px 40px"><div style="display:flex;align-items:center;gap:12px">{PIN.format(w=26)}<span class="ts lb" style="font-size:24px">Postcode</span></div><div class="ts hv" style="font-size:190px;margin-top:6px">2284</div></div></div>
<div class="g d" style="left:40px;top:360px;width:520px;height:228px;border-radius:44px"><div class="in ts hd" style="padding:36px 40px;font-size:54px">Find out where <span style="color:#D9C8F0">your home</span> sits.</div></div>'''+cta_b(660,512,500)

# 03 settings toggle
def toggle(w,h):
    return f'<span style="position:relative;display:inline-block;width:{w}px;height:{h}px;border-radius:999px;background:rgba(255,255,255,.22);box-shadow:inset 0 1px 2px rgba(0,0,0,.2)"><span style="position:absolute;left:{int(h*.08)}px;top:{int(h*.08)}px;width:{int(h*.84)}px;height:{int(h*.84)}px;border-radius:50%;background:#fff;box-shadow:0 4px 10px rgba(0,0,0,.25)"></span></span>'
@ad('03-zero-fees')
def a03(size):
    if size=='s':
        return bg('street.jpg','50% 50%')+orbs('s')+f'''
<div class="ts hd" style="position:absolute;left:70px;right:70px;top:250px;font-size:84px">Tired of management fees eating into your rental return?</div>
<div class="g" style="left:60px;right:60px;top:640px;height:460px;border-radius:64px"><div class="in" style="padding:20px 56px">
<div style="display:flex;align-items:center;justify-content:space-between;height:140px;border-bottom:2px solid rgba(255,255,255,.25)"><span class="ts" style="font-size:48px;font-weight:600">Management fees</span>{toggle(150,88)}</div>
<div style="display:flex;align-items:center;justify-content:space-between;height:280px"><span class="ts mut" style="font-size:44px">You pay</span><span class="ts hv" style="font-size:230px;color:#E6D9F5">$0</span></div></div></div>
<div class="ts" style="position:absolute;left:70px;right:70px;top:1150px;font-size:72px;font-weight:700;letter-spacing:-.03em">Pay zero management fees.</div>'''+cta_s()
    return bg('street.jpg','50% 50%')+orbs('b')+f'''
<div class="ts hd" style="position:absolute;left:44px;top:60px;width:560px;font-size:50px">Tired of management fees eating into your rental return?</div>
<div class="ts" style="position:absolute;left:44px;top:330px;width:560px;font-size:40px;font-weight:700;letter-spacing:-.03em;color:#fff">Pay zero management fees.</div>
<div class="g" style="left:650px;top:60px;width:500px;height:390px;border-radius:44px"><div class="in" style="padding:10px 36px">
<div style="display:flex;align-items:center;justify-content:space-between;height:96px;border-bottom:1.5px solid rgba(255,255,255,.25)"><span class="ts" style="font-size:30px;font-weight:600">Management fees</span>{toggle(96,56)}</div>
<div style="display:flex;align-items:center;justify-content:space-between;height:270px"><span class="ts mut" style="font-size:28px">You pay</span><span class="ts hv" style="font-size:190px;color:#E6D9F5">$0</span></div></div></div>'''+cta_b(44,500,560)

# 04 glass receipt
@ad('04-zero-fees-receipt')
def a04(size):
    if size=='s':
        rows=''.join(f'<div style="display:flex;align-items:center;gap:20px;margin:30px 0"><span class="ph" style="width:{a}px"></span><span style="flex:1;border-bottom:3px dotted rgba(255,255,255,.35)"></span><span class="ph" style="width:{b}px"></span></div>' for a,b in [(240,110),(300,90),(200,120)])
        return bg('street.jpg','30% 60%')+orbs('s')+f'''
<div class="ts hd" style="position:absolute;left:70px;right:70px;top:250px;font-size:84px">Tired of management fees eating into <span style="color:#D9C8F0">your rental return?</span></div>
<div class="g" style="left:110px;right:110px;top:640px;height:700px;border-radius:56px;transform:rotate(-3deg)"><div class="in" style="padding:56px 60px">
<div class="ts lb" style="font-size:28px;letter-spacing:.2em;text-transform:uppercase">Rental statement</div>{rows}
<div style="border-top:3px dashed rgba(255,255,255,.5);margin:36px 0"></div>
<div class="ts" style="display:flex;align-items:baseline;gap:20px;font-size:48px;font-weight:700"><span>Management fees</span><span style="flex:1;border-bottom:3px dotted rgba(255,255,255,.35)"></span><span style="font-size:96px;color:#E6D9F5">$0</span></div></div></div>'''+cta_s(1380)
    rows=''.join(f'<div style="display:flex;align-items:center;gap:12px;margin:16px 0"><span class="ph" style="width:{a}px;height:12px"></span><span style="flex:1;border-bottom:2px dotted rgba(255,255,255,.35)"></span><span class="ph" style="width:{b}px;height:12px"></span></div>' for a,b in [(140,70),(180,60)])
    return bg('street.jpg','30% 60%')+orbs('b')+f'''
<div class="ts hd" style="position:absolute;left:44px;top:110px;width:560px;font-size:52px">Tired of management fees eating into <span style="color:#D9C8F0">your rental return?</span></div>
<div class="g" style="left:680px;top:70px;width:460px;height:420px;border-radius:36px;transform:rotate(-3deg)"><div class="in" style="padding:34px 36px">
<div class="ts lb" style="font-size:17px;letter-spacing:.2em;text-transform:uppercase">Rental statement</div>{rows}
<div style="border-top:2px dashed rgba(255,255,255,.5);margin:22px 0"></div>
<div class="ts" style="display:flex;align-items:baseline;gap:12px;font-size:28px;font-weight:700"><span>Management fees</span><span style="flex:1;border-bottom:2px dotted rgba(255,255,255,.35)"></span><span style="font-size:64px;color:#E6D9F5">$0</span></div></div></div>'''+cta_b(44,420,560)

# 05 lock screen notifications
def notif(size,text,icon):
    if size=='s':
        return f'<div class="g rel" style="border-radius:58px;margin-bottom:22px"><div class="in" style="display:flex;gap:32px;align-items:center;padding:44px 48px"><div style="flex:none;width:112px;height:112px;border-radius:28px;background:linear-gradient(145deg,#C2ADE0,#7B5CA8);display:grid;place-items:center;box-shadow:inset 0 2px 1px rgba(255,255,255,.6)">{icon}</div><div class="ts" style="flex:1;font-size:52px;font-weight:500;letter-spacing:-.02em;line-height:1.15">{text}</div><span class="ts mut" style="align-self:flex-start;font-size:30px">now</span></div></div>'
    return f'<div class="g rel" style="border-radius:34px;margin-bottom:12px"><div class="in" style="display:flex;gap:20px;align-items:center;padding:22px 26px"><div style="flex:none;width:64px;height:64px;border-radius:16px;background:linear-gradient(145deg,#C2ADE0,#7B5CA8);display:grid;place-items:center">{icon}</div><div class="ts" style="flex:1;font-size:30px;font-weight:500;letter-spacing:-.02em;line-height:1.15">{text}</div><span class="ts mut" style="align-self:flex-start;font-size:18px">now</span></div></div>'
@ad('05-more-than-expected')
def a05(size):
    if size=='s':
        return bg('alfresco.jpg','50% 40%')+orbs('s')+f'''
<div style="position:absolute;left:0;right:0;top:250px;text-align:center"><div class="ts lb" style="font-size:40px">If a buyer presented</div><div class="hv" style="font-size:330px;color:rgba(255,255,255,.9);text-shadow:0 2px 0 rgba(255,255,255,.35),0 10px 50px rgba(57,43,61,.45)">More</div></div>
<div style="position:absolute;left:50px;right:50px;top:840px">{notif('s','than you expected,',UP)}{notif('s','would you consider it?',HOUSE)}</div>'''+cta_s()
    return bg('alfresco.jpg','50% 40%')+orbs('b')+f'''
<div style="position:absolute;left:44px;top:70px;width:520px"><div class="ts lb" style="font-size:28px">If a buyer presented</div><div class="hv" style="font-size:210px;color:rgba(255,255,255,.92);text-shadow:0 10px 40px rgba(57,43,61,.45)">More</div></div>
<div style="position:absolute;left:600px;top:110px;width:560px">{notif('b','than you expected,',UP)}{notif('b','would you consider it?',HOUSE)}</div>'''+cta_b(600,420,560)

# 06 slider
def slider(w,h,size):
    th=int(h*1.9)
    return f'<div style="position:relative;height:{th}px"><div style="position:absolute;left:0;right:0;top:{(th-h)//2}px;height:{h}px;border-radius:999px;background:rgba(255,255,255,.22);box-shadow:inset 0 1px 3px rgba(0,0,0,.2)"></div><div style="position:absolute;left:0;width:78%;top:{(th-h)//2}px;height:{h}px;border-radius:999px;background:linear-gradient(90deg,rgba(194,173,224,.6),#C2ADE0)"></div><div class="g" style="left:calc(78% - {th//2}px);top:0;width:{th}px;height:{th}px;border-radius:50%;background:rgba(255,255,255,.85)"></div></div>'
@ad('06-right-price')
def a06(size):
    if size=='s':
        return bg('living.jpg','50% 80%')+orbs('s')+f'''
<div class="g" style="left:60px;right:60px;top:380px;height:780px;border-radius:76px"><div class="in" style="padding:80px 70px">
<div class="ts hd" style="font-size:100px">Would <span style="color:#E2D3F5">the right price</span> change your mind about selling?</div>
<div style="margin-top:110px">{slider(0,26,'s')}</div></div></div>'''+cta_s()
    return bg('living.jpg','50% 80%')+orbs('b')+f'''
<div class="g" style="left:40px;top:60px;width:1120px;height:330px;border-radius:44px"><div class="in" style="padding:46px 50px">
<div class="ts hd" style="font-size:58px;width:900px">Would <span style="color:#E2D3F5">the right price</span> change your mind about selling?</div>
<div style="margin-top:46px;width:1020px">{slider(0,16,'b')}</div></div></div>'''+cta_b(40,440,560)

# 07 glass price tag
def tag(w,size):
    fs1,fs2=(110,150) if size=='s' else (56,78)
    return f'''<div class="g" style="left:0;top:0;width:100%;height:100%;border-radius:{int(w*.05)}px;clip-path:polygon(16% 0,100% 0,100% 100%,16% 100%,0 50%)"><div class="in" style="height:100%;display:flex;flex-direction:column;justify-content:center;padding-left:26%"><div class="ts" style="font-size:{fs1}px;font-weight:300;font-style:italic;letter-spacing:-.03em;line-height:1">the right</div><div class="ts hv" style="font-size:{fs2}px;color:#E6D9F5">PRICE</div></div></div><div style="position:absolute;left:9%;top:50%;width:{int(w*.05)}px;height:{int(w*.05)}px;margin-top:-{int(w*.025)}px;border-radius:50%;background:rgba(255,255,255,.85);box-shadow:inset 0 2px 4px rgba(0,0,0,.3)"></div>'''
@ad('07-right-price-tag')
def a07(size):
    if size=='s':
        return bg('living.jpg','50% 70%')+orbs('s')+f'''
<div style="position:absolute;left:120px;top:330px;width:860px;height:440px;transform:rotate(-8deg)">{tag(860,'s')}</div>
<div class="ts hd" style="position:absolute;left:70px;right:70px;top:930px;font-size:92px">Would the right price change your mind about selling?</div>'''+cta_s()
    return bg('living.jpg','50% 70%')+orbs('b')+f'''
<div style="position:absolute;left:50px;top:110px;width:500px;height:260px;transform:rotate(-8deg)">{tag(500,'b')}</div>
<div class="ts hd" style="position:absolute;left:620px;top:90px;width:540px;font-size:56px">Would the right price change your mind about selling?</div>'''+cta_b(620,450,540)

# 08 glass message bubbles
def bubs(size):
    if size=='s':
        fs,pad,r,gap='64px','40px 52px','60px','18px'
    else:
        fs,pad,r,gap='32px','20px 28px','32px','10px'
    return f'''<div style="display:flex;flex-direction:column;gap:{gap};align-items:flex-start">
<div class="g rel" style="border-radius:{r};border-bottom-left-radius:14px;max-width:92%"><div class="in ts" style="padding:{pad};font-size:{fs};font-weight:500;letter-spacing:-.02em;line-height:1.12">You might not be planning&nbsp;to&nbsp;sell.</div></div>
<div class="g t rel" style="border-radius:{r};border-bottom-left-radius:14px;max-width:96%"><div class="in ts" style="padding:{pad};font-size:{fs};font-weight:600;letter-spacing:-.02em;line-height:1.12">But if a buyer presented more than you expected, would you consider it?</div></div>
<div class="g rel" style="border-radius:{r};padding:{pad}"><div class="in" style="display:flex;gap:{gap}"><i style="width:{"22px" if size=="s" else "12px"};height:{"22px" if size=="s" else "12px"};border-radius:50%;background:#fff"></i><i style="width:{"22px" if size=="s" else "12px"};height:{"22px" if size=="s" else "12px"};border-radius:50%;background:#fff;opacity:.7"></i><i style="width:{"22px" if size=="s" else "12px"};height:{"22px" if size=="s" else "12px"};border-radius:50%;background:#fff;opacity:.4"></i></div></div></div>'''
@ad('08-not-planning-to-sell')
def a08(size):
    if size=='s':
        return bg('roofline.jpg','60% 80%')+orbs('s')+f'''<div class="ts mut" style="position:absolute;left:0;right:0;top:420px;text-align:center;font-size:30px">Today</div><div style="position:absolute;left:60px;right:60px;top:500px">{bubs('s')}</div>'''+cta_s()
    return bg('roofline.jpg','60% 80%')+orbs('b')+f'''<div style="position:absolute;left:40px;top:50px;width:620px">{bubs('b')}</div>'''+cta_b(40,480,560)

# 09/10 glass number plaque
def plaque(num,size):
    if size=='s':
        sc='<span style="position:absolute;width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#bbb);box-shadow:0 2px 4px rgba(0,0,0,.3);{p}"></span>'
        pos=['left:34px;top:34px','right:34px;top:34px','left:34px;bottom:34px','right:34px;bottom:34px']
        return f'<div class="g" style="left:90px;right:90px;top:560px;height:460px;border-radius:48px"><div class="in ts hv" style="height:100%;display:grid;place-items:center;font-size:330px">{num}</div>{"".join(sc.format(p=x) for x in pos)}</div>'
    sc='<span style="position:absolute;width:18px;height:18px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#bbb);box-shadow:0 2px 4px rgba(0,0,0,.3);{p}"></span>'
    pos=['left:18px;top:18px','right:18px;top:18px','left:18px;bottom:18px','right:18px;bottom:18px']
    return f'<div class="g" style="left:40px;top:200px;width:520px;height:260px;border-radius:30px"><div class="in ts hv" style="height:100%;display:grid;place-items:center;font-size:190px">{num}</div>{"".join(sc.format(p=x) for x in pos)}</div>'
def own(num,photo,pos,colour):
    def f(size):
        if size=='s':
            return bg(photo,pos,colour)+('' if colour else orbs('s'))+f'''
<div class="ts hv" style="position:absolute;left:0;right:0;top:300px;text-align:center;font-size:200px">Own in</div>{plaque(num,'s')}
<div class="g d" style="left:90px;right:90px;top:1060px;height:230px;border-radius:48px"><div class="in ts" style="padding:44px 50px;font-size:52px;font-weight:600;letter-spacing:-.02em;line-height:1.15;text-align:center">Even if you've only thought about selling, we'd love to start <span style="color:#E2D3F5">a conversation.</span></div></div>'''+cta_s()
        return bg(photo,pos,colour)+('' if colour else orbs('b'))+f'''
<div class="ts hv" style="position:absolute;left:44px;top:60px;font-size:120px">Own in</div>{plaque(num,'b')}
<div class="g d" style="left:620px;top:120px;width:540px;height:230px;border-radius:36px"><div class="in ts" style="padding:34px 38px;font-size:36px;font-weight:600;letter-spacing:-.02em;line-height:1.18">Even if you've only thought about selling, we'd love to start <span style="color:#E2D3F5">a conversation.</span></div></div>'''+cta_b(620,400,540)
    return f
ADS.append(('09-own-in-2287',own('2287','house-colour.jpg','48% 50%',True)))
ADS.append(('10-own-in-2284',own('2284','kitchen.jpg','50% 50%',False)))

for size,prefix in [('s','glass-story'),('b','glass-banner')]:
    html=[HEAD]
    for slug,fn in ADS:
        html.append(f'<section class="ad {size}" id="{prefix}-{slug}">{fn(size)}</section>')
    html.append('</body></html>')
    open(f'{OUT}/{prefix}s.html','w').write('\n'.join(html))
print('ok',len(ADS))
