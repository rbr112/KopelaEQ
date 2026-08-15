import math
SR=48000; N=48000
L=[math.sin(2*math.pi*1000*i/SR) for i in range(N)]
R=[math.sin(2*math.pi*2000*i/SR) for i in range(N)]
def frame(l,r,width=1,balance=0,swap=False,mono=False):
    width=0 if mono else max(0,min(2,width)); mid=(l+r)*.5; side=(l-r)*.5*width
    lo=(mid+side)*(1-balance if balance>0 else 1); ro=(mid-side)*(1+balance if balance<0 else 1)
    return (ro,lo) if swap else (lo,ro)
mono=[frame(l,r,width=0) for l,r in zip(L,R)]
assert max(abs(a-b) for a,b in mono)<1e-12
for l,r in zip(L[::997],R[::997]):
    a,b=frame(l,r,width=1); assert abs(a-l)<1e-12 and abs(b-r)<1e-12
    a,b=frame(l,r,width=1,swap=True); assert abs(a-r)<1e-12 and abs(b-l)<1e-12
print('stereo_math_check.py: PASS')
