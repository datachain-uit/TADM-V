use ff::PrimeField;
use pasta_curves::Fp;
use rand_core::{OsRng, RngCore};

pub fn field_to_hex(value: Fp) -> String {
    let mut bytes = value.to_repr();

    bytes.as_mut().reverse();

    format!("0x{}", hex::encode(bytes))
}

pub fn random_field() -> Fp {
    loop {
        let mut bytes = [0u8; 32];

        OsRng.fill_bytes(&mut bytes);

        let mut repr = <Fp as PrimeField>::Repr::default();

        repr.as_mut().copy_from_slice(&bytes);

        if let Some(value) = Option::<Fp>::from(Fp::from_repr(repr)) {
            return value;
        }
    }
}

pub fn hex_to_field(value: &str) -> Fp {
    let value = value.trim_start_matches("0x");

    let mut bytes = hex::decode(value).unwrap();

    bytes.reverse();

    let mut repr = <Fp as PrimeField>::Repr::default();

    repr.as_mut().copy_from_slice(&bytes);

    Fp::from_repr(repr).unwrap()
}

pub fn decimal_to_field(value: &str) -> Fp {
    let mut result = Fp::from(0);

    for byte in value.bytes() {
        if byte < b'0' || byte > b'9' {
            panic!("rho must be decimal string");
        }

        let digit = (byte - b'0') as u64;

        result = result * Fp::from(10) + Fp::from(digit);
    }

    result
}

fn eth_address_to_field(address: &str) -> Fp {
    let clean = address.trim_start_matches("0x");

    let bytes = hex::decode(clean).unwrap();

    let mut repr = [0u8; 32];

    repr[12..32].copy_from_slice(&bytes);

    repr.reverse();

    Fp::from_repr(repr).unwrap()
}

pub fn recipient_to_field(value: &str) -> Fp {
    let clean = value.trim_start_matches("0x");

    if !clean.chars().all(|c| c.is_ascii_hexdigit()) {
        panic!("recipient must be hex: {}", value);
    }

    match clean.len() {
        40 => eth_address_to_field(clean),

        64 => {
            let bytes = hex::decode(clean).unwrap();

            if bytes[..12].iter().any(|b| *b != 0) {
                panic!("recipient word has non-zero high bytes — not an address: {}", value);
            }

            eth_address_to_field(&hex::encode(&bytes[12..]))
        }

        _ => panic!("recipient must be a 20-byte address or a 32-byte word: {}", value),
    }
}
