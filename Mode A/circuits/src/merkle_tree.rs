use pasta_curves::pallas::Base as Fp;

use crate::poseidon::poseidon_hash_merkle;

#[derive(Clone, Debug)]
pub struct MerkleTree {
    pub depth: usize,
    pub nodes: Vec<Vec<Fp>>,

    pub zeros: Vec<Fp>,
}

impl MerkleTree {
    pub fn new(depth: usize) -> Self {
        let mut nodes = Vec::new();

        nodes.push(vec![]);

        for _ in 1..=depth {
            nodes.push(vec![]);
        }

        Self { depth, nodes, zeros: Self::empty_subtree_roots(depth) }
    }

    fn empty_subtree_roots(depth: usize) -> Vec<Fp> {
        let mut zeros = Vec::with_capacity(depth + 1);

        zeros.push(Fp::from(0u64));

        for level in 0..depth {
            let z = zeros[level];
            zeros.push(poseidon_hash_merkle(z, z));
        }

        zeros
    }

    pub fn insert(&mut self, leaf: Fp) {
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

            let parent = poseidon_hash_merkle(left, right);

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

                let parent = poseidon_hash_merkle(left, right);
                next_level.push(parent);
            }

            self.nodes[level + 1] = next_level;
        }
    }

    pub fn root(&self) -> Fp {
        self.nodes[self.depth][0]
    }

    pub fn get_path(&self, mut index: usize) -> (Vec<Fp>, Vec<bool>) {
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
}

pub fn native_merkle_root(leaf: Fp, siblings: &[Fp], directions: &[bool]) -> Fp {
    let mut current = leaf;

    for (sibling, direction) in siblings.iter().zip(directions.iter()) {
        current =
            if *direction { poseidon_hash_merkle(*sibling, current) } else { poseidon_hash_merkle(current, *sibling) };
    }

    current
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEPTH: usize = 7;
    const MAX_LEAVES: usize = 1 << DEPTH;

    fn build_by_full_rebuild(leaves: &[Fp]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.nodes[0].push(*leaf);
            tree.build_tree();
        }

        tree
    }

    fn build_by_insert(leaves: &[Fp]) -> MerkleTree {
        let mut tree = MerkleTree::new(DEPTH);

        for leaf in leaves {
            tree.insert(*leaf);
        }

        tree
    }

    fn sample_leaf(i: usize) -> Fp {
        Fp::from((i as u64 + 1) * 1_000_003)
    }

    #[test]
    fn insert_matches_full_rebuild_for_every_n_up_to_128() {
        for n in 1..=MAX_LEAVES {
            let leaves: Vec<Fp> = (0..n).map(sample_leaf).collect();

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
        assert_eq!(tree.zeros[0], Fp::from(0u64));

        for level in 0..DEPTH {
            assert_eq!(
                tree.zeros[level + 1],
                poseidon_hash_merkle(tree.zeros[level], tree.zeros[level]),
                "zeros[{}] is not H(zeros[{}], zeros[{}])",
                level + 1,
                level,
                level
            );
        }
    }

    #[test]
    fn paths_match_for_every_index() {
        for n in [1usize, 2, 3, 5, 8, 17, 33, 64, 127, 128] {
            let leaves: Vec<Fp> = (0..n).map(sample_leaf).collect();

            let rebuilt = build_by_full_rebuild(&leaves);
            let inserted = build_by_insert(&leaves);

            for index in 0..n {
                assert_eq!(
                    rebuilt.get_path(index),
                    inserted.get_path(index),
                    "Merkle path differs at n = {}, index = {}",
                    n,
                    index
                );
            }
        }
    }

    #[test]
    fn native_root_matches_tree_root() {
        let leaves: Vec<Fp> = (0..5).map(sample_leaf).collect();
        let tree = build_by_insert(&leaves);

        for index in 0..leaves.len() {
            let (siblings, directions) = tree.get_path(index);

            assert_eq!(native_merkle_root(leaves[index], &siblings, &directions), tree.root());
        }
    }
}

#[cfg(test)]
mod insert_speed {
    use super::*;
    use std::time::Instant;

    #[test]
    #[ignore]
    fn measure_insert_speedup() {
        const DEPTH: usize = 7;
        println!();
        println!("  n      full rebuild (n^2/2)   insert (7n)    speedup");
        println!("  {}", "-".repeat(52));

        for n in [10usize, 20, 50, 100, 128] {
            let leaves: Vec<Fp> = (0..n).map(|i| Fp::from((i as u64 + 1) * 1_000_003)).collect();

            let t = Instant::now();
            let mut rebuilt = MerkleTree::new(DEPTH);
            for l in &leaves {
                rebuilt.nodes[0].push(*l);
                rebuilt.build_tree();
            }
            let rebuild_ms = t.elapsed().as_secs_f64() * 1000.0;

            let t = Instant::now();
            let mut inserted = MerkleTree::new(DEPTH);
            for l in &leaves {
                inserted.insert(*l);
            }
            let insert_ms = t.elapsed().as_secs_f64() * 1000.0;

            assert_eq!(rebuilt.root(), inserted.root());
            println!("  {:<7}{:>10.1} ms{:>13.1} ms{:>12.1}x", n, rebuild_ms, insert_ms, rebuild_ms / insert_ms);
        }
        println!();
    }
}
