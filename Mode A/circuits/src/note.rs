use pasta_curves::pallas;
// use rand_core::OsRng;
// use halo2_proofs::arithmetic::Field;

#[derive(Clone, Debug)]
pub struct Note {
    pub student_id: pallas::Base,
    pub scholarship_amount: pallas::Base,
    pub rho: pallas::Base
}

impl Note {
    pub fn new(student_id: pallas::Base, scholarship_amount: pallas::Base, rho: pallas::Base) -> Self {
        // let rho = pallas::Base::random(OsRng);
        Self {
            student_id,
            scholarship_amount,
            rho
        }
    }
}

// Tests
// #[cfg(test)]
// mod tests {
//     use super::*;
//     use pasta_curves::pallas;
//     #[test]
//     fn test_note() {
//         let note = Note::new(
//             pallas::Base::from(001),
//             pallas::Base::from(002)
//         );

//         println!("{:?}", note);
//     }

// }