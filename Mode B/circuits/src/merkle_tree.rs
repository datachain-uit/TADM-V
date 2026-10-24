use halo2_base::halo2_proofs::halo2curves::bn256::Fr;

use halo2_base::{
    Context, AssignedValue,
    gates::{GateInstructions, flex_gate::GateChip, circuit::builder::BaseCircuitBuilder},
};

use crate::poseidon::PoseidonChip;

#[derive(Clone, Debug)]
pub struct MerkleTree {
    pub depth: usize,

    pub nodes: Vec<Vec<Fr>>,

    pub zeros: Vec<Fr>,
}

#[derive(Clone, Debug)]
pub struct MerkleProof {
    pub siblings: Vec<AssignedValue<Fr>>,

    pub directions: Vec<AssignedValue<Fr>>,
}

#[derive(Clone, Debug)]
pub struct MerkleWitness {
    pub leaf: Fr,

    pub siblings: Vec<Fr>,

    pub directions: Vec<bool>,

    pub root: Fr,
}

impl MerkleProof {
    pub fn from_witness(ctx: &mut Context<Fr>, witness: &MerkleWitness) -> Self {
        let siblings = witness.siblings.iter().map(|s| ctx.load_witness(*s)).collect();

        let directions = witness
            .directions
            .iter()
            .map(|is_right| {
                let direction_value = if *is_right { Fr::one() } else { Fr::zero() };

                ctx.load_witness(direction_value)
            })
            .collect();

        Self { siblings, directions }
    }
}

pub struct MerkleTreeChip;

impl MerkleTree {
    pub fn new(depth: usize) -> Self {
        let mut nodes = Vec::new();

        nodes.push(vec![]);

        for _ in 1..=depth {
            nodes.push(vec![]);
        }

        Self { depth, nodes, zeros: Self::empty_subtree_roots(depth) }
    }

    fn empty_subtree_roots(depth: usize) -> Vec<Fr> {
        let mut zeros = Vec::with_capacity(depth + 1);

        zeros.push(Fr::from(0u64));

        for level in 0..depth {
            let z = zeros[level];

            zeros.push(Self::poseidon_parent(z, z));
        }

        zeros
    }

    pub fn insert(&mut self, leaf: Fr) {
        self.nodes[0].push(leaf);

        let mut index = self.nodes[0].len() - 1;

        for level in 0..self.depth {
            let parent_index = index / 2;

            let left_index = parent_index * 2;

            let (left, right) = {
                let current = &self.nodes[level];

                let left = current[left_index];

                let right = if left_index + 1 < current.len() { current[left_index + 1] } else { self.zeros[level] };

                (left, right)
            };

            let parent = Self::poseidon_parent(left, right);

            let next = &mut self.nodes[level + 1];

            if parent_index < next.len() {
                next[parent_index] = parent;
            } else {
                debug_assert_eq!(
                    parent_index,
                    next.len(),
                    "level {} skipped an index: parent_index={} but len={}",
                    level + 1,
                    parent_index,
                    next.len()
                );

                next.push(parent);
            }

            index = parent_index;
        }
    }

    #[cfg(test)]
    fn build_tree(&mut self) {
        for level in 0..self.depth {
            let current_level = self.nodes[level].clone();

            let mut next_level = vec![];

            for i in (0..current_level.len()).step_by(2) {
                let left = current_level[i];

                let right = if i + 1 < current_level.len() { current_level[i + 1] } else { self.zeros[level] };

                let parent = Self::poseidon_parent(left, right);

                next_level.push(parent);
            }

            self.nodes[level + 1] = next_level;
        }
    }

    fn poseidon_parent(left: Fr, right: Fr) -> Fr {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);

        let mut ctx = builder.main(0);

        let gate = GateChip::<Fr>::new();

        let mut hasher = PoseidonChip::new_hasher();

        let left_assigned = ctx.load_witness(left);

        let right_assigned = ctx.load_witness(right);

        let inputs = vec![left_assigned, right_assigned];

        let hash = PoseidonChip::hash_note(&mut ctx, &gate, &mut hasher, &inputs);

        *hash.value()
    }

    pub fn root(&self) -> Fr {
        self.nodes[self.depth][0]
    }

    pub fn get_path(&self, mut index: usize) -> (Vec<Fr>, Vec<bool>) {
        let mut siblings = vec![];

        let mut directions = vec![];

        for level in 0..self.depth {
            let level_nodes = &self.nodes[level];

            let is_right = index % 2 == 1;

            let sibling_index = if is_right { index - 1 } else { index + 1 };

            let sibling =
                if sibling_index < level_nodes.len() { level_nodes[sibling_index] } else { self.zeros[level] };

            siblings.push(sibling);

            directions.push(is_right);

            index /= 2;
        }

        (siblings, directions)
    }

    pub fn create_witness(&self, index: usize) -> MerkleWitness {
        let leaf = self.nodes[0][index];

        let (siblings, directions) = self.get_path(index);

        let root = self.root();

        MerkleWitness { leaf, siblings, directions, root }
    }
}

impl MerkleTreeChip {
    pub fn compute_root(
        ctx: &mut Context<Fr>,

        gate: &GateChip<Fr>,

        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,

        leaf: AssignedValue<Fr>,

        proof: &MerkleProof,
    ) -> AssignedValue<Fr> {
        let mut current = leaf;

        for (sibling, direction) in proof.siblings.iter().zip(proof.directions.iter()) {
            let sibling = *sibling;

            let direction = *direction;

            let one = ctx.load_constant(Fr::one());

            let direction_minus_one = gate.sub(ctx, direction, one);

            let boolean_check = gate.mul(ctx, direction, direction_minus_one);

            gate.assert_is_const(ctx, &boolean_check, &Fr::zero());

            let one_minus_direction = gate.sub(ctx, one, direction);

            let current_when_left = gate.mul(ctx, current, one_minus_direction);

            let sibling_when_left = gate.mul(ctx, sibling, direction);

            let left = gate.add(ctx, current_when_left, sibling_when_left);

            let sibling_when_right = gate.mul(ctx, sibling, one_minus_direction);

            let current_when_right = gate.mul(ctx, current, direction);

            let right = gate.add(ctx, sibling_when_right, current_when_right);

            let inputs = vec![left, right];

            current = PoseidonChip::hash_note(ctx, gate, hasher, &inputs);
        }

        current
    }

    pub fn verify_membership(
        ctx: &mut Context<Fr>,

        gate: &GateChip<Fr>,

        hasher: &mut halo2_base::poseidon::hasher::PoseidonHasher<Fr, 3, 2>,

        leaf: AssignedValue<Fr>,

        proof: &MerkleProof,

        expected_root: AssignedValue<Fr>,
    ) {
        let computed_root = Self::compute_root(ctx, gate, hasher, leaf, proof);

        let is_equal = gate.is_equal(ctx, computed_root, expected_root);

        gate.assert_is_const(ctx, &is_equal, &Fr::one());
    }
}

pub fn native_merkle_root(leaf: Fr, witness: &MerkleWitness) -> Fr {
    let mut builder = BaseCircuitBuilder::<Fr>::new(false);
    let mut ctx = builder.main(0);
    let gate = GateChip::<Fr>::new();
    let mut hasher = PoseidonChip::new_hasher();

    let leaf_assigned = ctx.load_witness(leaf);

    let proof = MerkleProof::from_witness(&mut ctx, witness);

    let computed_root = MerkleTreeChip::compute_root(&mut ctx, &gate, &mut hasher, leaf_assigned, &proof);

    *computed_root.value()
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEPTH: usize = 7;

    fn build_by_full_rebuild(leaves: &[Fr]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.nodes[0].push(*leaf);
            tree.build_tree();
        }

        tree
    }

    fn build_by_insert(leaves: &[Fr]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.insert(*leaf);
        }

        tree
    }

    fn sample_leaf(i: usize) -> Fr {
        Fr::from((i as u64 + 1) * 1_000_003)
    }

    fn assert_insert_matches_full_rebuild(n: usize) {
        let leaves: Vec<Fr> = (0..n).map(sample_leaf).collect();

        let rebuilt = build_by_full_rebuild(&leaves);
        let inserted = build_by_insert(&leaves);

        assert_eq!(
            rebuilt.root(),
            inserted.root(),
            "ROOT MISMATCH at n = {} — an {} count",
            n,
            if n % 2 == 1 { "ODD" } else { "even" }
        );

        for level in 0..=DEPTH {
            assert_eq!(rebuilt.nodes[level], inserted.nodes[level], "level {} differs at n = {}", level, n);
        }
    }

    #[test]
    fn empty_slot_and_repeated_leaf_give_different_roots() {
        let a = sample_leaf(0);
        let b = sample_leaf(1);
        let c = sample_leaf(2);

        let three_leaves = build_by_insert(&[a, b, c]);
        let four_leaves = build_by_insert(&[a, b, c, c]);

        assert_ne!(
            three_leaves.root(),
            four_leaves.root(),
            "[a,b,c] and [a,b,c,c] give the SAME root — padding went back to \
             duplicating the last leaf, so the root no longer identifies the leaf set"
        );
    }

    #[test]
    fn zeros_table_matches_definition() {
        let tree = MerkleTree::new(DEPTH);

        assert_eq!(tree.zeros.len(), DEPTH + 1);
        assert_eq!(tree.zeros[0], Fr::from(0u64));

        for level in 0..DEPTH {
            assert_eq!(
                tree.zeros[level + 1],
                MerkleTree::poseidon_parent(tree.zeros[level], tree.zeros[level]),
                "zeros[{}] is not H(zeros[{}], zeros[{}])",
                level + 1,
                level,
                level
            );
        }
    }

    #[test]
    fn insert_matches_full_rebuild_for_small_n() {
        for n in 1..=24 {
            assert_insert_matches_full_rebuild(n);
        }
    }

    #[test]
    fn insert_matches_full_rebuild_at_power_of_two_boundaries() {
        for n in [31usize, 32, 33, 63, 64, 65, 127, 128] {
            assert_insert_matches_full_rebuild(n);
        }
    }

    #[test]
    fn native_root_matches_tree_root() {
        let leaves: Vec<Fr> = (0..5).map(sample_leaf).collect();
        let tree = build_by_insert(&leaves);

        for index in 0..leaves.len() {
            let witness = tree.create_witness(index);

            assert_eq!(native_merkle_root(leaves[index], &witness), tree.root());
        }
    }
}
