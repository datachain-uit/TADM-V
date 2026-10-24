use ff_ce::hex;
use halo2_base::halo2_proofs::halo2curves::{bn256::Fr, ff::PrimeField};
use rand_core::{OsRng, RngCore};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(untagged)]
pub enum DecimalInput {
    Number(u64),
    String(String),
}

pub fn field_to_hex(value: Fr) -> String {
    let mut bytes = value.to_repr().as_ref().to_vec();
    bytes.reverse();
    format!("0x{}", hex::encode(bytes))
}

pub fn random_field() -> Fr {
    loop {
        let mut bytes = [0u8; 32];

        OsRng.fill_bytes(&mut bytes);

        let mut repr = <Fr as PrimeField>::Repr::default();
        repr.as_mut().copy_from_slice(&bytes);

        if let Some(value) = Option::<Fr>::from(Fr::from_repr(repr)) {
            return value;
        }
    }
}

pub fn hex_to_field(value: &str) -> Fr {
    let raw = value.strip_prefix("0x").unwrap_or(value);
    if raw.len() != 64 {
        panic!("Expected a bytes32 hex value");
    }

    let mut bytes = hex::decode(raw).expect("Invalid bytes32 hex");
    bytes.reverse();

    let mut repr = <Fr as PrimeField>::Repr::default();
    repr.as_mut().copy_from_slice(&bytes);
    Option::<Fr>::from(Fr::from_repr(repr)).expect("bytes32 value is not a canonical BN254 scalar")
}

pub fn decimal_to_field(value: &str) -> Fr {
    if value.is_empty() {
        panic!("Decimal field must not be empty");
    }

    value.bytes().fold(Fr::from(0), |accumulator, byte| {
        if !byte.is_ascii_digit() {
            panic!("Expected an unsigned decimal string");
        }

        accumulator * Fr::from(10) + Fr::from((byte - b'0') as u64)
    })
}

pub fn decimal_input_to_field(value: &DecimalInput) -> Fr {
    match value {
        DecimalInput::Number(number) => Fr::from(*number),
        DecimalInput::String(string) => decimal_to_field(string),
    }
}

pub fn recipient_to_field(value: &str) -> Fr {
    let raw = value.strip_prefix("0x").unwrap_or(value);
    if !raw.chars().all(|c| c.is_ascii_hexdigit()) {
        panic!("recipient must be hex: {}", value);
    }
    let bytes = hex::decode(raw).expect("Invalid recipient hex");
    let address: Vec<u8> = match bytes.len() {
        20 => bytes,
        32 => {
            if bytes[..12].iter().any(|b| *b != 0) {
                panic!("recipient word has non-zero high bytes — not an address: {}", value);
            }
            bytes[12..].to_vec()
        }
        _ => panic!("recipient must be a 20-byte address or a 32-byte word: {}", value),
    };
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(&address);
    word.reverse();
    let mut repr = <Fr as PrimeField>::Repr::default();
    repr.as_mut().copy_from_slice(&word);
    Option::<Fr>::from(Fr::from_repr(repr)).expect("recipient is not a canonical BN254 scalar")
}
