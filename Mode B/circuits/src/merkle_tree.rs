use halo2_base::halo2_proofs::halo2curves::bn256::Fr;

use halo2_base::{
    Context,
    AssignedValue,

    gates::{
        GateInstructions,
        flex_gate::GateChip,
        circuit::builder::BaseCircuitBuilder,
    },
};

use crate::poseidon::PoseidonChip;

#[derive(Clone, Debug)]
pub struct MerkleTree {

    pub depth: usize,

    pub nodes:
        Vec<Vec<Fr>>,

    // Goc cay con RONG cho tung tang: zeros[l] la root cua cay con cao
    // l tang ma moi o la deu trong. Dung de lap o trong khi mot tang co
    // so nut le. Tinh mot lan trong `new`, ton dung `depth` phep bam.
    pub zeros:
        Vec<Fr>,
}

#[derive(Clone, Debug)]
pub struct MerkleProof {

    pub siblings:
        Vec<AssignedValue<Fr>>,

    // pub directions:
    //     Vec<bool>,

    pub directions:
        Vec<AssignedValue<Fr>>,
}


#[derive(Clone, Debug)]
pub struct MerkleWitness {

    pub leaf: Fr,

    pub siblings: Vec<Fr>,

    pub directions: Vec<bool>,

    pub root: Fr,
}

impl MerkleWitness {
    pub fn new(
        leaf: Fr,
        siblings: Vec<Fr>,
        directions: Vec<bool>,
        root: Fr,
    ) -> Self {

        Self {

            leaf,

            siblings,

            directions,

            root,
        }
    }
}


// impl MerkleProof {

//     pub fn from_witness(

//         ctx: &mut Context<Fr>,

//         witness: &MerkleWitness,

//     ) -> Self {

//         let siblings =
//             witness
//                 .siblings
//                 .iter()
//                 .map(|s| {

//                     ctx.load_witness(*s)

//                 })
//                 .collect();

//         Self {

//             siblings,

//             directions:
//                 witness
//                     .directions
//                     .clone(),
//         }
//     }
// }



impl MerkleProof {

    pub fn from_witness(

        ctx: &mut Context<Fr>,

        witness: &MerkleWitness,

    ) -> Self {

        let siblings =
            witness
                .siblings
                .iter()
                .map(|s| {

                    ctx.load_witness(*s)

                })
                .collect();

        let directions =
            witness
                .directions
                .iter()
                .map(|is_right| {

                    let direction_value =
                        if *is_right {

                            Fr::one()

                        } else {

                            Fr::zero()
                        };

                    ctx.load_witness(
                        direction_value
                    )

                })
                .collect();

        Self {

            siblings,

            directions,
        }
    }
}



pub struct MerkleTreeChip;

impl MerkleTree {

    // =========================
    // CREATE TREE
    // =========================

    pub fn new(
        depth: usize,
    ) -> Self {

        let mut nodes =
            Vec::new();

        nodes.push(vec![]);

        for _ in 1..=depth {

            nodes.push(vec![]);
        }

        Self {
            depth,
            nodes,
            zeros:
                Self::empty_subtree_roots(
                    depth
                ),
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
    fn empty_subtree_roots(
        depth: usize,
    ) -> Vec<Fr> {

        let mut zeros =
            Vec::with_capacity(depth + 1);

        zeros.push(Fr::from(0u64));

        for level in 0..depth {

            let z = zeros[level];

            zeros.push(
                Self::poseidon_parent(
                    z,
                    z,
                )
            );
        }

        zeros
    }

    // =========================
    // INSERT LEAF
    // =========================

    // K9, 2026-08-21
    //
    // Them mot la thi CHI cac nut tren duong tu la len goc doi gia tri,
    // dung bang `depth` nut. Ban cu goi `build_tree()` dung lai TOAN BO
    // cay sau moi la:
    //
    //     chen n la  ->  1 + 2 + ... + n  ~=  n²/2  phep bam
    //     ban nay    ->  n × depth        =   7n    phep bam
    //
    // O nhanh nay loi hon ADV nhieu, vi `poseidon_parent` dung han mot
    // `BaseCircuitBuilder` cho MOI phep bam — moi lan bam rat dat.
    // Do duoc: `tree_and_witness_ms` 77 ms (n=1) -> 44 307 ms (n=100).
    //
    // BAT BUOC giu nguyen ba quy uoc, doi mot cai la doi root:
    //   1. o trong -> zeros[level] (goc cay con RONG cua tang do).
    //      DOI 2026-08-28: truoc day nhan doi nut trai (kieu Bitcoin).
    //      Quy uoc nhan doi lam ROOT KHONG XAC DINH DUY NHAT tap la:
    //      [a,b,c] va [a,b,c,c] cho cung mot root, vi ca hai deu ra
    //      tang 1 = [H(a,b), H(c,c)]. Do la CVE-2012-2459 cua Bitcoin.
    //      Tornado Cash / Semaphore / Zcash deu lap bang hang so.
    //   2. thu tu  -> poseidon_parent(trai, phai), H(a,b) != H(b,a)
    //   3. cay CO NGHIA LA mang co dinh 2^depth o, moi o hoac la mot
    //      commitment hoac la zeros[0]. `nodes` chi luu phan da dung
    //      de khoi phai giu 128 o rong trong bo nho — day la chi tiet
    //      cai dat, khong phai dinh nghia cua cay.
    //
    // `build_tree()` giu lai lam BAN DOI CHUNG cho test — xem `k9_tests`.
    pub fn insert(
        &mut self,
        leaf: Fr,
    ) {
        self.nodes[0]
            .push(leaf);

        let mut index =
            self.nodes[0].len() - 1;

        for level in 0..self.depth {
            let parent_index =
                index / 2;

            let left_index =
                parent_index * 2;

            // Doc hai con TRUOC, de muon bat bien roi moi ghi tang tren.
            let (left, right) = {
                let current =
                    &self.nodes[level];

                let left =
                    current[left_index];

                let right =
                    if left_index + 1 < current.len() {
                        current[left_index + 1]
                    } else {
                        // quy uoc 1: o trong, khong phai ban sao
                        self.zeros[level]
                    };

                (left, right)
            };

            let parent =
                Self::poseidon_parent(
                    left,
                    right,
                );

            let next =
                &mut self.nodes[level + 1];

            if parent_index < next.len() {
                next[parent_index] = parent;
            } else {
                // Chi duoc phep noi dai dung mot o.
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
    // BUILD TREE
    // =========================

    // Ban CU — khong con duoc goi trong duong chay that.
    // Giu nguyen ven de test so root cua hai thuat toan (K9).
    #[allow(dead_code)]
    fn build_tree(
        &mut self,
    ) {

        for level in 0..self.depth {

            let current_level =
                self.nodes[level].clone();

            let mut next_level =
                vec![];

            for i in
                (0..current_level.len())
                    .step_by(2)
            {

                let left =
                    current_level[i];

                let right =
                    if i + 1 < current_level.len() {

                        current_level[i + 1]

                    } else {

                        // o trong (phai khop `insert`)
                        self.zeros[level]
                    };

                let parent =
                    Self::poseidon_parent(
                        left,
                        right,
                    );

                next_level.push(parent);
            }

            self.nodes[level + 1] =
                next_level;
        }
    }

    // =========================
    // OFF CIRCUIT POSEIDON
    // =========================

    fn poseidon_parent(
        left: Fr,
        right: Fr,
    ) -> Fr {

        let mut builder =
            BaseCircuitBuilder::<Fr>::new(false);

        let mut ctx =
            builder.main(0);

        let gate =
            GateChip::<Fr>::new();

        let mut hasher =
            PoseidonChip::new_hasher();

        let left_assigned =
            ctx.load_witness(left);

        let right_assigned =
            ctx.load_witness(right);

        let inputs =
            vec![
                left_assigned,
                right_assigned,
            ];

        let hash =
            PoseidonChip::hash_note(
                &mut ctx,
                &gate,
                &mut hasher,
                &inputs,
            );

        *hash.value()
    }

    // =========================
    // ROOT
    // =========================

    pub fn root(
        &self,
    ) -> Fr {

        self.nodes[self.depth][0]
    }

    // =========================
    // GET PATH
    // =========================

    pub fn get_path(
        &self,
        mut index: usize,
    ) -> (Vec<Fr>, Vec<bool>) {

        let mut siblings =
            vec![];

        let mut directions =
            vec![];

        for level in 0..self.depth {

            let level_nodes =
                &self.nodes[level];

            let is_right =
                index % 2 == 1;

            let sibling_index =
                if is_right {

                    index - 1

                } else {

                    index + 1
                };

            let sibling =
                if sibling_index < level_nodes.len() {

                    level_nodes[sibling_index]

                } else {

                    // o trong (phai khop `insert`)
                    self.zeros[level]
                };

            siblings.push(sibling);

            directions.push(is_right);

            index /= 2;
        }

        (
            siblings,
            directions,
        )
    }




    pub fn create_witness(
        &self,
        index: usize,
    ) -> MerkleWitness {

        let leaf =
            self.nodes[0][index];

        let (
            siblings,
            directions,
        ) = self.get_path(index);

        let root =
            self.root();

        MerkleWitness {

            leaf,

            siblings,

            directions,

            root,
        }
    }
}

impl MerkleTreeChip {

    // =========================
    // COMPUTE ROOT
    // =========================

    // pub fn compute_root(

    //     ctx: &mut Context<Fr>,

    //     gate: &GateChip<Fr>,

    //     hasher:
    //         &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,

    //     leaf:
    //         AssignedValue<Fr>,

    //     proof:
    //         &MerkleProof,

    // ) -> AssignedValue<Fr> {

    //     let mut current =
    //         leaf;

    //     for (
    //         sibling,
    //         is_right,
    //     ) in proof
    //         .siblings
    //         .iter()
    //         .zip(
    //             proof.directions.iter()
    //         )
    //     {

    //         let left;
    //         let right;

    //         if *is_right {

    //             left =
    //                 *sibling;

    //             right =
    //                 current;

    //         } else {

    //             left =
    //                 current;

    //             right =
    //                 *sibling;
    //         }

    //         let inputs =
    //             vec![
    //                 left,
    //                 right,
    //             ];

    //         current =
    //             PoseidonChip::hash_note(
    //                 ctx,
    //                 gate,
    //                 hasher,
    //                 &inputs,
    //             );
    //     }

    //     current
    // }



    pub fn compute_root(

        ctx: &mut Context<Fr>,

        gate: &GateChip<Fr>,

        hasher:
            &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,

        leaf:
            AssignedValue<Fr>,

        proof:
            &MerkleProof,

    ) -> AssignedValue<Fr> {

        let mut current =
            leaf;

        for (
            sibling,
            direction,
        ) in proof
            .siblings
            .iter()
            .zip(
                proof.directions.iter()
            )
        {

            let sibling =
                *sibling;

            let direction =
                *direction;

            // direction phải là boolean:
            // direction * (direction - 1) = 0
            let one =
                ctx.load_constant(
                    Fr::one()
                );

            let direction_minus_one =
                gate.sub(
                    ctx,
                    direction,
                    one,
                );

            let boolean_check =
                gate.mul(
                    ctx,
                    direction,
                    direction_minus_one,
                );

            gate.assert_is_const(
                ctx,
                &boolean_check,
                &Fr::zero(),
            );

            // one_minus_direction = 1 - direction
            let one_minus_direction =
                gate.sub(
                    ctx,
                    one,
                    direction,
                );

            // left = current * (1 - direction) + sibling * direction
            let current_when_left =
                gate.mul(
                    ctx,
                    current,
                    one_minus_direction,
                );

            let sibling_when_left =
                gate.mul(
                    ctx,
                    sibling,
                    direction,
                );

            let left =
                gate.add(
                    ctx,
                    current_when_left,
                    sibling_when_left,
                );

            // right = sibling * (1 - direction) + current * direction
            let sibling_when_right =
                gate.mul(
                    ctx,
                    sibling,
                    one_minus_direction,
                );

            let current_when_right =
                gate.mul(
                    ctx,
                    current,
                    direction,
                );

            let right =
                gate.add(
                    ctx,
                    sibling_when_right,
                    current_when_right,
                );

            let inputs =
                vec![
                    left,
                    right,
                ];

            current =
                PoseidonChip::hash_note(
                    ctx,
                    gate,
                    hasher,
                    &inputs,
                );
        }

        current
    }








    // =========================
    // VERIFY MEMBERSHIP
    // =========================

    pub fn verify_membership(

        ctx: &mut Context<Fr>,

        gate: &GateChip<Fr>,

        hasher:
            &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,

        leaf:
            AssignedValue<Fr>,

        proof:
            &MerkleProof,

        expected_root:
            AssignedValue<Fr>,
    ) {

        let computed_root =
            Self::compute_root(
                ctx,
                gate,
                hasher,
                leaf,
                proof,
            );

        let is_equal =
            gate.is_equal(
                ctx,
                computed_root,
                expected_root,
            );

        gate.assert_is_const(
            ctx,
            &is_equal,
            &Fr::one(),
        );
    }
}


















// #[cfg(test)]
// mod tests {

//     use super::*;
    

//     #[test]
//     fn test_merkle_tree_membership() {

//         // =========================
//         // CREATE TREE
//         // =========================

//         // let mut tree =
//         //     MerkleTree::new(3);

//         // // depth = 2
//         // // total leaves = 4

//         // tree.insert(
//         //     Fr::from(10)
//         // );

//         // tree.insert(
//         //     Fr::from(20)
//         // );

//         // tree.insert(
//         //     Fr::from(30)
//         // );

//         // tree.insert(
//         //     Fr::from(40)
//         // );

//         // // =========================
//         // // GET ROOT
//         // // =========================

//         // let root =
//         //     tree.root();

//         // eprintln!(
//         //     "root = {:?}",
//         //     root,
//         // );

//         // // =========================
//         // // GET PATH
//         // // =========================

//         // let (
//         //     siblings,
//         //     directions,
//         // ) = tree.get_path(2);

//         // eprintln!(
//         //     "siblings len = {}",
//         //     siblings.len(),
//         // );

//         // eprintln!("siblings = [");
//         // for s in &siblings {
//         //     eprintln!("  {:?}", s);
//         // }
//         // eprintln!("]");

//         // eprintln!(
//         //     "directions = {:?}",
//         //     directions,
//         // );

//         // =========================
//         // CIRCUIT
//         // =========================

//         let mut builder =
//             BaseCircuitBuilder::<Fr>::new(false);

//         let mut ctx =
//             builder.main(0);

//         let gate =
//             GateChip::<Fr>::new();

//         let mut hasher =
//             PoseidonChip::new_hasher();

//         let note1 = crate::note::Note {
//             student_id: ctx.load_witness(Fr::from(24560002)),
//             amount: ctx.load_witness(Fr::from(2)),
//             rho: ctx.load_witness(Fr::from(1234567))
//         };

//         let note2 = crate::note::Note {
//             student_id: ctx.load_witness(Fr::from(24560003)),
//             amount: ctx.load_witness(Fr::from(3)),
//             rho: ctx.load_witness(Fr::from(1234568))
//         };

//         let commitment1 = crate::commitment::CommitmentChip::create_commitment(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             &note1,
//         );

//         let commitment2 = crate::commitment::CommitmentChip::create_commitment(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             &note2,
//         );


//         let mut tree =
//             MerkleTree::new(3);

//         // depth = 2
//         // total leaves = 4

//         tree.insert(
//             // Fr::from(10)
//             *commitment1.value()
//         );

//         tree.insert(
//             *commitment2.value()
//         );

//         let witness = tree.create_witness(0);

//         // tree.insert(
//         //     Fr::from(30)
//         // );

//         // tree.insert(
//         //     Fr::from(40)
//         // );

//         // =========================
//         // GET ROOT
//         // =========================

//         let root =
//             tree.root();

//         eprintln!(
//             "root = {:?}",
//             root,
//         );

//         // =========================
//         // GET PATH
//         // =========================

//         let (
//             siblings,
//             directions,
//         ) = tree.get_path(0);

//         eprintln!(
//             "siblings len = {}",
//             siblings.len(),
//         );

//         eprintln!("siblings = [");
//         for s in &siblings {
//             eprintln!("  {:?}", s);
//         }
//         eprintln!("]");

//         eprintln!(
//             "directions = {:?}",
//             directions,
//         );

//         // leaf = 30
//         // let leaf =
//         //     ctx.load_witness(
//         //         Fr::from(30)
//         //     );

        

//         let assigned_siblings:
//             Vec<AssignedValue<Fr>>
//             =
//             siblings
//                 .iter()
//                 .map(|x| {
//                     ctx.load_witness(*x)
//                 })
//                 .collect();

//         let merkle_path =
//             MerkleProof {

//                 siblings:
//                     assigned_siblings,

//                 directions,
//             };

//         let expected_root =
//             ctx.load_witness(root);

//         // =========================
//         // VERIFY
//         // =========================

//         MerkleTreeChip::verify_membership(
//             &mut ctx,
//             &gate,
//             &mut hasher,
//             commitment1,
//             &merkle_path,
//             expected_root,
//         );

//         eprintln!(
//             "membership constraint added"
//         );
//     }
// }
// =========================================================
// K9 — TEST DOI CHUNG  (2026-08-21)
// =========================================================
//
// `insert` moi va `build_tree` cu phai cho ra ROOT TRUNG TUNG BIT.
// Hai thuat toan la hai cach tinh CUNG MOT gia tri, khong phai hai
// dinh nghia — lech nghia la mot trong hai co bug.
//
// Lech mot truong hop la proof cu hong het va root tren chuoi thanh
// vo nghia. Test nay khong duoc phep bo qua.
//
// Ban ONC chay CHAM hon ban ADV nhieu vi `poseidon_parent` dung mot
// BaseCircuitBuilder moi lan bam — nen chi quet toi 64 la thay vi 128,
// va quet DAY DU cac so LE (cho quy uoc dem o trong phat huy tac dung).
#[cfg(test)]
mod k9_tests {
    use super::*;

    const DEPTH: usize = 7;

    fn dung_bang_ban_cu(leaves: &[Fr]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.nodes[0].push(*leaf);
            tree.build_tree();
        }

        tree
    }

    fn dung_bang_ban_moi(leaves: &[Fr]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.insert(*leaf);
        }

        tree
    }

    fn la_thu(i: usize) -> Fr {
        Fr::from((i as u64 + 1) * 1_000_003)
    }

    fn so_khop(n: usize) {
        let leaves: Vec<Fr> = (0..n).map(la_thu).collect();

        let cu = dung_bang_ban_cu(&leaves);
        let moi = dung_bang_ban_moi(&leaves);

        assert_eq!(
            cu.root(),
            moi.root(),
            "ROOT LECH o n = {} — day la so {}",
            n,
            if n % 2 == 1 { "LE" } else { "chan" }
        );

        // Root trung ma nut duoi lech thi `get_path` tra sibling sai,
        // va proof hong theo cach rat kho tim.
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
        assert_eq!(tree.zeros[0], Fr::from(0u64));

        for level in 0..DEPTH {
            assert_eq!(
                tree.zeros[level + 1],
                MerkleTree::poseidon_parent(
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
    fn test_insert_khop_build_tree_n_nho() {
        // Quet DAY DU 1..=24: day la vung moi tang deu doi hinh dang,
        // va la vung de sai nhat.
        for n in 1..=24 {
            so_khop(n);
        }
    }

    #[test]
    fn test_insert_khop_build_tree_n_bien() {
        // Cac moc dac biet: luy thua 2, luy thua 2 +/- 1, va tran cay.
        for n in [31usize, 32, 33, 63, 64, 65, 127, 128] {
            so_khop(n);
        }
    }
}
