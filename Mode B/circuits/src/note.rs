use halo2_base::halo2_proofs::halo2curves::bn256::Fr;
use halo2_base::AssignedValue;

#[derive(Clone, Debug)]
pub struct Note {
    pub student_id: AssignedValue<Fr>,
    pub amount: AssignedValue<Fr>,
    pub rho: AssignedValue<Fr>,
}

impl Note {

    // convert note -> vector để hash Poseidon
    pub fn to_vec(&self) -> Vec<AssignedValue<Fr>> {
        vec![
            self.student_id,
            self.amount,
            self.rho,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_base::{
        Context,
        gates::circuit::builder::BaseCircuitBuilder,
        halo2_proofs::halo2curves::bn256::Fr,
    };
   

    #[test]
    fn test_note_to_vec() {

        

        let mut builder = BaseCircuitBuilder::<Fr>::new(false);
        let ctx = builder.main(0);

        // giả lập assign values
        let student_id = ctx.load_witness(Fr::from(123));
        let amount = ctx.load_witness(Fr::from(2));
        let rho = ctx.load_witness(Fr::from(999));

        let note = Note {
            student_id,
            amount,
            rho,
        };

        let vec = note.to_vec();

        // kiểm tra length
        assert_eq!(vec.len(), 3);

        // KHÔNG PRINT VALUE RAW, chỉ debug witness
        eprintln!("Note created with 3 fields");

        // debug circuit assignment
        for (i, v) in vec.iter().enumerate() {
            eprintln!("field {} assigned", i);
        }
    }
}