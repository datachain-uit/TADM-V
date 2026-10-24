use halo2_base::halo2_proofs::halo2curves::bn256::Fr;
use halo2_base::AssignedValue;

#[derive(Clone, Debug)]
pub struct Note {
    pub student_id: Fr,
    pub amount: Fr,
    pub rho: Fr,
}

#[derive(Clone, Debug)]
pub struct AssignedNote {
    pub student_id: AssignedValue<Fr>,
    pub amount: AssignedValue<Fr>,
    pub rho: AssignedValue<Fr>,
}

impl AssignedNote {
    pub fn to_vec(&self) -> Vec<AssignedValue<Fr>> {
        vec![self.student_id, self.amount, self.rho]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_base::{gates::circuit::builder::BaseCircuitBuilder, halo2_proofs::halo2curves::bn256::Fr};

    #[test]
    fn to_vec_returns_the_three_note_fields() {
        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let ctx = builder.main(0);

        let student_id = ctx.load_witness(Fr::from(123));
        let amount = ctx.load_witness(Fr::from(2));
        let rho = ctx.load_witness(Fr::from(999));

        let note = AssignedNote { student_id, amount, rho };

        let values = note.to_vec();

        assert_eq!(values.len(), 3);

        eprintln!("Note created with 3 fields");

        for (i, _) in values.iter().enumerate() {
            eprintln!("field {} assigned", i);
        }
    }
}
