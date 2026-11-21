use glam::Vec3;

#[derive(Clone, Copy)]
struct Triangle { a: Vec3, b: Vec3, c: Vec3, center: Vec3, lo: Vec3, hi: Vec3 }
struct Node { lo: Vec3, hi: Vec3, left: Option<usize>, right: Option<usize>, start: usize, end: usize }
struct Bvh { triangles: Vec<Triangle>, order: Vec<usize>, nodes: Vec<Node> }

impl Bvh {
    fn new(triangles: Vec<Triangle>) -> Self {
        let mut b = Self { order: (0..triangles.len()).collect(), triangles, nodes: Vec::new() };
        if !b.order.is_empty() { b.build(0, b.order.len()); }
        b
    }
    fn build(&mut self, start: usize, end: usize) -> usize {
        let mut lo = Vec3::splat(f32::INFINITY);
        let mut hi = Vec3::splat(f32::NEG_INFINITY);
        let mut clo = lo; let mut chi = hi;
        for i in start..end {
            let t = self.triangles[self.order[i]];
            lo = lo.min(t.lo); hi = hi.max(t.hi);
            clo = clo.min(t.center); chi = chi.max(t.center);
        }
        let id = self.nodes.len();
        self.nodes.push(Node { lo, hi, left: None, right: None, start, end });
        if end - start > 8 {
            let extent = chi - clo;
            let axis = if extent.x >= extent.y && extent.x >= extent.z { 0 } else if extent.y >= extent.z { 1 } else { 2 };
            self.order[start..end].sort_unstable_by(|a,b| self.triangles[*a].center[axis].total_cmp(&self.triangles[*b].center[axis]));
            let mid = (start + end) / 2;
            let left = self.build(start, mid);
            let right = self.build(mid, end);
            self.nodes[id].left = Some(left); self.nodes[id].right = Some(right);
        }
        id
    }
    fn hit_aabb(lo: Vec3, hi: Vec3, o: Vec3, d: Vec3, max_t: f32) -> bool {
        let inv = Vec3::new(1.0 / d.x, 1.0 / d.y, 1.0 / d.z);
        let t1 = (lo - o) * inv; let t2 = (hi - o) * inv;
        let near = t1.min(t2).max_element().max(0.0);
        let far = t1.max(t2).min_element();
        far >= near && near < max_t
    }
    fn hit_triangle(t: Triangle, o: Vec3, d: Vec3, max_t: f32) -> bool {
        let e1 = t.b - t.a; let e2 = t.c - t.a;
        let p = d.cross(e2); let det = e1.dot(p);
        if det.abs() < 1e-7 { return false; }
        let inv = 1.0 / det; let s = o - t.a;
        let u = s.dot(p) * inv;
        if !(0.0001..=0.9999).contains(&u) { return false; }
        let q = s.cross(e1); let v = d.dot(q) * inv;
        if v < 0.0001 || u + v > 0.9999 { return false; }
        let distance = e2.dot(q) * inv;
        distance > 0.0005 && distance < max_t
    }
    fn occluded(&self, node_id: usize, o: Vec3, d: Vec3, max_t: f32) -> bool {
        let node = &self.nodes[node_id];
        if !Self::hit_aabb(node.lo, node.hi, o, d, max_t) { return false; }
        if let (Some(l), Some(r)) = (node.left, node.right) {
            self.occluded(l, o, d, max_t) || self.occluded(r, o, d, max_t)
        } else {
            (node.start..node.end).any(|i| Self::hit_triangle(self.triangles[self.order[i]], o, d, max_t))
        }
    }
}

pub fn compute_vertex_ao(positions: &[Vec3], normals: &[Vec3], indices: &[u32], radius: f32) -> Vec<f32> {
    let mut triangles = Vec::with_capacity(indices.len() / 3);
    for tri in indices.chunks_exact(3) {
        let (a,b,c) = (positions[tri[0] as usize], positions[tri[1] as usize], positions[tri[2] as usize]);
        let lo = a.min(b).min(c); let hi = a.max(b).max(c);
        if (b-a).cross(c-a).length_squared() > 1e-10 {
            triangles.push(Triangle { a,b,c,center:(a+b+c)/3.0,lo,hi });
        }
    }
    if triangles.is_empty() { return vec![1.0; positions.len()]; }
    let bvh = Bvh::new(triangles);
    let golden = std::f32::consts::PI * (3.0 - 5.0_f32.sqrt());
    let max_distance = (radius * 0.16).max(0.02);
    let mut output = Vec::with_capacity(positions.len());
    for (i, &position) in positions.iter().enumerate() {
        let n = normals.get(i).copied().unwrap_or(Vec3::Y).normalize_or(Vec3::Y);
        let tangent = if n.y.abs() < 0.9 { n.cross(Vec3::Y).normalize_or(Vec3::X) } else { n.cross(Vec3::X).normalize_or(Vec3::Z) };
        let bitangent = n.cross(tangent).normalize_or(Vec3::Z);
        let origin = position + n * (radius * 0.0008).max(0.0002);
        let mut blocked = 0.0;
        const RAYS: usize = 12;
        for ray in 0..RAYS {
            let z = (ray as f32 + 0.5) / RAYS as f32;
            let r = (1.0 - z*z).sqrt();
            let phi = golden * ray as f32;
            let local = Vec3::new(r*phi.cos(), r*phi.sin(), z);
            let direction = (tangent*local.x + bitangent*local.y + n*local.z).normalize_or(n);
            if bvh.occluded(0, origin, direction, max_distance) { blocked += 1.0; }
        }
        output.push((1.0 - blocked / RAYS as f32 * 0.78).clamp(0.32, 1.0));
    }
    output
}
