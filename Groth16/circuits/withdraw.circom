pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";

template MerklePath(depth) {

    signal input leaf;
    signal input siblings[depth];
    signal input directions[depth];

    signal output root;

    component hasher[depth];

    signal cur[depth + 1];
    signal left[depth];
    signal right[depth];

    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {

        directions[i] * (directions[i] - 1) === 0;

        left[i]  <== cur[i]      + directions[i] * (siblings[i] - cur[i]);
        right[i] <== siblings[i] + directions[i] * (cur[i] - siblings[i]);

        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== left[i];
        hasher[i].inputs[1] <== right[i];

        cur[i + 1] <== hasher[i].out;
    }

    root <== cur[depth];
}

template Withdraw(depth) {

    signal input student_id;
    signal input rho;
    signal input siblings[depth];
    signal input directions[depth];

    signal input root;
    signal input nullifier;
    signal input amount;

    signal input recipient;
    signal recipientSquare;
    recipientSquare <== recipient * recipient;

    component cm = Poseidon(3);
    cm.inputs[0] <== student_id;
    cm.inputs[1] <== amount;
    cm.inputs[2] <== rho;

    component nf = Poseidon(1);
    nf.inputs[0] <== rho;
    nf.out === nullifier;

    component path = MerklePath(depth);
    path.leaf <== cm.out;

    for (var i = 0; i < depth; i++) {
        path.siblings[i]   <== siblings[i];
        path.directions[i] <== directions[i];
    }

    path.root === root;
}

component main {public [root, nullifier, amount, recipient]} = Withdraw(9);
