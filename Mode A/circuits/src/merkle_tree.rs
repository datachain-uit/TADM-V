use pasta_curves::pallas::Base as Fp;
use crate::poseidon::{poseidon_hash_merkle};

#[derive(Clone, Debug)]
pub struct MerkleTree {
    pub depth: usize,
    pub nodes: Vec<Vec<Fp>>, // level by level

    // Goc cay con RONG cho tung tang: zeros[l] la root cua cay con cao
    // l tang ma moi o la deu trong. Dung de lap o trong khi mot tang co
    // so nut le. Tinh mot lan trong `new`, ton dung `depth` phep bam.
    pub zeros: Vec<Fp>,
}

impl MerkleTree {
    pub fn new(depth: usize) -> Self {
        let mut nodes = Vec::new();

        // level 0 = leaves
        nodes.push(vec![]);

        for _ in 1..=depth {
            nodes.push(vec![]);
        }

        Self {
            depth,
            nodes,
            zeros: Self::empty_subtree_roots(depth),
        }
    }

    // =========================
    // EMPTY SUBTREE ROOTS  —  2026-08-28
    // =========================
    //
    //     zeros[0]   = o la trong
    //     zeros[l+1] = H(zeros[l], zeros[l])
    //
    // Dung khuon Tornado Cash `MerkleTreeWithHistory.sol` va Semaphore.
    // Tornado lay zeros[0] = keccak("tornado") % p thay vi 0 de o trong
    // khong the trung mot la hop le; la cua ta la output Poseidon nen
    // xac suat trung 0 khong dang ke, dung 0 cho gon.
    fn empty_subtree_roots(depth: usize) -> Vec<Fp> {
        let mut zeros = Vec::with_capacity(depth + 1);

        zeros.push(Fp::from(0u64));

        for level in 0..depth {
            let z = zeros[level];
            zeros.push(poseidon_hash_merkle(z, z));
        }

        zeros
    }

    // =========================
    // INSERT LEAF  —  K9, 2026-08-21
    // =========================
    //
    // Them mot la thi CHI cac nut tren duong tu la len goc doi gia tri,
    // dung bang `depth` nut. Ban cu goi `build_tree()` dung lai TOAN BO
    // cay sau moi la:
    //
    //     chen n la  ->  1 + 2 + ... + n  ~=  n²/2  phep bam
    //     ban nay    ->  n × depth        =   7n    phep bam
    //
    // Do duoc trong thuc nghiem: `witness_ms` 77 ms (n=1) -> 44 307 ms
    // (n=100), bac tang n^1,38 va LON DAN — dung dau hieu O(n²).
    //
    // BAT BUOC giu nguyen ba quy uoc, doi mot cai la doi root:
    //   1. o trong -> zeros[level] (goc cay con RONG cua tang do).
    //      DOI 2026-08-28: truoc day nhan doi nut trai (kieu Bitcoin).
    //      Quy uoc nhan doi lam ROOT KHONG XAC DINH DUY NHAT tap la:
    //      [a,b,c] va [a,b,c,c] cho cung mot root, vi ca hai deu ra
    //      tang 1 = [H(a,b), H(c,c)]. Do la CVE-2012-2459 cua Bitcoin.
    //      Tornado Cash / Semaphore / Zcash deu lap bang hang so.
    //   2. thu tu  -> hash(trai, phai), H(a,b) != H(b,a)
    //   3. cay CO NGHIA LA mang co dinh 2^depth o, moi o hoac la mot
    //      commitment hoac la zeros[0]. `nodes` chi luu phan da dung
    //      de khoi phai giu 128 o rong trong bo nho — day la chi tiet
    //      cai dat, khong phai dinh nghia cua cay.
    //
    // `build_tree()` duoc giu lai lam BAN DOI CHUNG cho test — xem
    // `test_insert_khop_build_tree` o cuoi file.
    pub fn insert(&mut self, leaf: Fp) {
        self.nodes[0].push(leaf);

        let mut index = self.nodes[0].len() - 1;

        for level in 0..self.depth {
            let parent_index = index / 2;
            let left_index = parent_index * 2;

            // Doc hai con TRUOC, de muon bat bien roi moi ghi tang tren.
            let (left, right) = {
                let current = &self.nodes[level];

                let left = current[left_index];

                let right = if left_index + 1 < current.len() {
                    current[left_index + 1]
                } else {
                    self.zeros[level] // quy uoc 1: o trong, khong phai ban sao
                };

                (left, right)
            };

            let parent = poseidon_hash_merkle(left, right);

            let next = &mut self.nodes[level + 1];

            if parent_index < next.len() {
                next[parent_index] = parent;
            } else {
                // Chi duoc phep noi dai dung mot o. Lech nghia la
                // chi so tang tren da khong con nhat quan.
                debug_assert_eq!(
                    parent_index,
                    next.len(),
                    "level {} ho chi so: parent_index={} nhung len={}",
                    level + 1,
                    parent_index,
                    next.len()
                );

                next.push(parent);
            }

            index = parent_index;
        }
    }

    // =========================
    // BUILD TREE  —  ban cu, giu lam DOI CHUNG cho test
    // =========================
    //
    // Khong con duoc goi trong duong chay that. Dung nguyen ven de test
    // co the so root cua hai thuat toan.
    #[allow(dead_code)]
    fn build_tree(&mut self) {
        for level in 0..self.depth {
            let current_level = self.nodes[level].clone();
            let mut next_level = vec![];

            for i in (0..current_level.len()).step_by(2) {
                let left = current_level[i];
                let right = if i + 1 < current_level.len() {
                    current_level[i + 1]
                } else {
                    self.zeros[level] // o trong (phai khop `insert`)
                };

                let parent = poseidon_hash_merkle(left, right);
                next_level.push(parent);
            }

            self.nodes[level + 1] = next_level;
        }
    }

    // =========================
    // GET ROOT
    // =========================
    pub fn root(&self) -> Fp {
        self.nodes[self.depth][0]
    }

    // =========================
    // GET PATH
    // =========================
    pub fn get_path(&self, mut index: usize) -> (Vec<Fp>, Vec<bool>) {
        let mut siblings = vec![];
        let mut directions = vec![];

        for level in 0..self.depth {
            let level_nodes = &self.nodes[level];

            let is_right = index % 2 == 1;

            let sibling_index = if is_right {
                index - 1
            } else {
                index + 1
            };

            let sibling = if sibling_index < level_nodes.len() {
                level_nodes[sibling_index]
            } else {
                self.zeros[level] // o trong (phai khop `insert`)
            };

            siblings.push(sibling);
            directions.push(is_right);

            index /= 2;
        }

        (siblings, directions)
    }
}
// =========================================================
// K9 — TEST DOI CHUNG
// =========================================================
//
// `insert` moi va `build_tree` cu phai cho ra ROOT TRUNG TUNG BIT.
// Hai thuat toan la hai cach tinh CUNG MOT gia tri, khong phai hai
// dinh nghia — lech nghia la mot trong hai co bug.
//
// Lech mot truong hop la proof cu hong het va root tren chuoi thanh
// vo nghia, nen day la test khong duoc phep bo qua.
#[cfg(test)]
mod k9_tests {
    use super::*;

    const DEPTH: usize = 7;
    const MAX_LEAVES: usize = 1 << DEPTH; // 128

    /// Dung cay bang thuat toan CU: moi lan them la thi dung lai ca cay.
    fn dung_bang_ban_cu(leaves: &[Fp]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.nodes[0].push(*leaf);
            tree.build_tree();
        }

        tree
    }

    /// Dung cay bang thuat toan MOI: chi cap nhat duong tu la len goc.
    fn dung_bang_ban_moi(leaves: &[Fp]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.insert(*leaf);
        }

        tree
    }

    fn la_thu(i: usize) -> Fp {
        // Gia tri tuy y nhung xac dinh, de test tai lap duoc.
        Fp::from((i as u64 + 1) * 1_000_003)
    }

    #[test]
    fn test_insert_khop_build_tree_moi_n_tu_1_den_128() {
        for n in 1..=MAX_LEAVES {
            let leaves: Vec<Fp> = (0..n).map(la_thu).collect();

            let cu = dung_bang_ban_cu(&leaves);
            let moi = dung_bang_ban_moi(&leaves);

            assert_eq!(
                cu.root(),
                moi.root(),
                "ROOT LECH o n = {} — day la so {}",
                n,
                if n % 2 == 1 { "LE" } else { "chan" }
            );

            // Khong chi root: MOI nut o MOI tang phai trung.
            // Root trung ma nut duoi lech thi `get_path` se tra
            // sibling sai, va proof hong theo cach rat kho tim.
            for level in 0..=DEPTH {
                assert_eq!(
                    cu.nodes[level],
                    moi.nodes[level],
                    "tang {} lech o n = {}",
                    level,
                    n
                );
            }
        }
    }

    // =========================================================
    // 2026-08-28 — ROOT PHAI XAC DINH DUY NHAT TAP LA
    // =========================================================
    //
    // Quy uoc dem CU (nhan doi nut trai) lam hai tap la KHAC NHAU
    // cho ra CUNG mot root:
    //
    //     [a,b,c]    -> tang 1 = [H(a,b), H(c,c)]
    //     [a,b,c,c]  -> tang 1 = [H(a,b), H(c,c)]
    //
    // Do la CVE-2012-2459 cua Bitcoin. Voi zeros[] thi o trong va
    // "trung la truoc do" khong con lan nhau.
    //
    // Test nay do chinh cai tinh chat bi hong, nen no la thu chan
    // viec ai do quay lai quy uoc nhan doi.
    #[test]
    fn test_root_phan_biet_o_trong_voi_la_lap() {
        let a = la_thu(0);
        let b = la_thu(1);
        let c = la_thu(2);

        let ba_la = dung_bang_ban_moi(&[a, b, c]);
        let bon_la = dung_bang_ban_moi(&[a, b, c, c]);

        assert_ne!(
            ba_la.root(),
            bon_la.root(),
            "[a,b,c] va [a,b,c,c] cho CUNG root — quy uoc dem da quay \
             lai kieu nhan doi, root khong con xac dinh duy nhat tap la"
        );
    }

    // zeros[l+1] phai dung bang H(zeros[l], zeros[l]). Lech mot tang
    // la `insert` va `get_path` lap o trong bang hai gia tri khac nhau,
    // va moi proof di qua o trong deu hong.
    #[test]
    fn test_bang_zeros_dung_dinh_nghia() {
        let tree = MerkleTree::new(DEPTH);

        assert_eq!(tree.zeros.len(), DEPTH + 1);
        assert_eq!(tree.zeros[0], Fp::from(0u64));

        for level in 0..DEPTH {
            assert_eq!(
                tree.zeros[level + 1],
                poseidon_hash_merkle(
                    tree.zeros[level],
                    tree.zeros[level]
                ),
                "zeros[{}] khong bang H(zeros[{}], zeros[{}])",
                level + 1,
                level,
                level
            );
        }
    }

    #[test]
    fn test_duong_merkle_khop_moi_chi_so() {
        // Duong Merkle moi la thu that su di vao mach ZK.
        // Root trung nhung duong lech thi witness sai.
        for n in [1usize, 2, 3, 5, 8, 17, 33, 64, 127, 128] {
            let leaves: Vec<Fp> = (0..n).map(la_thu).collect();

            let cu = dung_bang_ban_cu(&leaves);
            let moi = dung_bang_ban_moi(&leaves);

            for index in 0..n {
                assert_eq!(
                    cu.get_path(index),
                    moi.get_path(index),
                    "duong Merkle lech o n = {}, chi so = {}",
                    n,
                    index
                );
            }
        }
    }
}

#[cfg(test)]
mod k9_do_toc_do {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore] // chay bang: cargo test -p circuits k9_do_toc_do --release -- --ignored --nocapture
    fn do_cai_thien() {
        const DEPTH: usize = 7;
        println!();
        println!("  n      ban CU (n^2/2)   ban MOI (7n)    nhanh hon");
        println!("  {}", "-".repeat(52));

        for n in [10usize, 20, 50, 100, 128] {
            let leaves: Vec<Fp> =
                (0..n).map(|i| Fp::from((i as u64 + 1) * 1_000_003)).collect();

            let t = Instant::now();
            let mut cu = MerkleTree::new(DEPTH);
            for l in &leaves { cu.nodes[0].push(*l); cu.build_tree(); }
            let ms_cu = t.elapsed().as_secs_f64() * 1000.0;

            let t = Instant::now();
            let mut moi = MerkleTree::new(DEPTH);
            for l in &leaves { moi.insert(*l); }
            let ms_moi = t.elapsed().as_secs_f64() * 1000.0;

            assert_eq!(cu.root(), moi.root());
            println!("  {:<7}{:>10.1} ms{:>13.1} ms{:>12.1}x",
                     n, ms_cu, ms_moi, ms_cu / ms_moi);
        }
        println!();
    }
}
