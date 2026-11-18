# Measures which edges of each KayKit hex tile carry road, river or water, by sampling the
# top-surface colour of the mesh at three points along each edge.
#
#   unzip KayKit_Medieval_Hexagon_Pack_1.0_FREE.zip
#   python3 tools/edges.py <pack>/Assets/gltf tiles/roads tiles/rivers tiles/coast
#
# Output per tile: six groups (edges 0..5, edge k faces angle 60*k from +x towards +z),
# G = grass, R = road or sand, W = water. js/tiles.js holds the result.
import json, struct, zlib, sys, math, os
root = sys.argv[1]
def png(path):
    d = open(path,'rb').read(); i = 8; idat=b''; 
    while i < len(d):
        n, t = struct.unpack('>I4s', d[i:i+8]); c = d[i+8:i+8+n]; i += 12+n
        if t==b'IHDR': w,h,bd,ct = struct.unpack('>IIBB', c[:10])
        elif t==b'IDAT': idat+=c
        elif t==b'PLTE': pal=c
    raw = zlib.decompress(idat); bpp = {2:3,6:4,0:1,3:1}[ct]; stride=w*bpp; out=[]; prev=bytearray(stride); p=0
    for y in range(h):
        f = raw[p]; line = bytearray(raw[p+1:p+1+stride]); p += 1+stride
        for x in range(stride):
            a = line[x-bpp] if x>=bpp else 0; b = prev[x]; c2 = prev[x-bpp] if x>=bpp else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                pa=abs(b-c2); pb=abs(a-c2); pc=abs(a+b-2*c2)
                pr = a if pa<=pb and pa<=pc else (b if pb<=pc else c2); line[x]=(line[x]+pr)&255
        out.append(bytes(line)); prev=line
    def px(u,v):
        x=min(w-1,max(0,int(u*w))); y=min(h-1,max(0,int(v*h))); o=x*bpp
        if ct==3: k=out[y][o]; return tuple(pal[k*3:k*3+3])
        return tuple(out[y][o:o+3])
    return px, (w,h,ct)
tex, info = png(os.path.join(root,'tiles/base/hexagons_medieval.png'))
def cls(c):
    r,g,b=c
    if b>r and b>g: return 'W'
    if r>200 and g>150 and b>100 and r-b<120: return 'R'   # tan road / sand
    return 'G'
def load(path):
    g=json.load(open(path)); buf=open(os.path.join(os.path.dirname(path), g['buffers'][0]['uri']),'rb').read()
    def acc(i):
        a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]; off=bv.get('byteOffset',0)+a.get('byteOffset',0)
        n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]; fmt={5126:'f',5123:'H',5125:'I'}[a['componentType']]
        sz=struct.calcsize(fmt); st=bv.get('byteStride',sz*n)
        return [struct.unpack_from('<'+fmt*n, buf, off+k*st) for k in range(a['count'])]
    pr=g['meshes'][0]['primitives'][0]; P=acc(pr['attributes']['POSITION']); U=acc(pr['attributes']['TEXCOORD_0']); I=[x[0] for x in acc(pr['indices'])]
    return P,U,I
def edges(path):
    P,U,I=load(path); res=[]
    tris=[]
    for t in range(0,len(I),3):
        a,b,c=I[t:t+3]; pa,pb,pc=P[a],P[b],P[c]
        u=[pb[k]-pa[k] for k in range(3)]; v=[pc[k]-pa[k] for k in range(3)]
        n=(u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]); L=math.sqrt(sum(x*x for x in n)) or 1
        uv=[(U[a][0]+U[b][0]+U[c][0])/3,(U[a][1]+U[b][1]+U[c][1])/3]
        tris.append((pa,pb,pc,abs(n[1])/L,cls(tex(*uv)), max(pa[1],pb[1],pc[1])))
    out=''
    for k in range(6):
      e=''
      for t in (-0.45,0,0.45):
        ang=math.radians(60*k); qx,qz=0.95*math.cos(ang)-t*math.sin(ang), 0.95*math.sin(ang)+t*math.cos(ang)
        best=None
        for pa,pb,pc,ny,cl,top in tris:
            if ny<0.3: continue
            def s(p1,p2): return (qx-p2[0])*(p1[2]-p2[2])-(p1[0]-p2[0])*(qz-p2[2])
            d1,d2,d3=s(pa,pb),s(pb,pc),s(pc,pa)
            if (d1<0 or d2<0 or d3<0) and (d1>0 or d2>0 or d3>0): continue
            if best is None or top>best[0]: best=(top,cl)
        e+= best[1] if best else '?'
      out+=e+' '
    return out
for d in sys.argv[2:]:
    for f in sorted(os.listdir(os.path.join(root,d))):
        if f.endswith('.gltf'): print(d, f[:-5], edges(os.path.join(root,d,f)))
