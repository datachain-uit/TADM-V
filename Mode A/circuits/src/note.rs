use pasta_curves::pallas;

#[derive(Clone, Debug)]
pub struct Note {
    pub student_id: pallas::Base,
    pub amount: pallas::Base,
    pub rho: pallas::Base,
}

impl Note {
    pub fn new(student_id: pallas::Base, amount: pallas::Base, rho: pallas::Base) -> Self {
        Self { student_id, amount, rho }
    }
}
