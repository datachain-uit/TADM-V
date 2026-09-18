use ff::PrimeField;
use pasta_curves::Fp;

// pub fn fp_to_hex(x: Fp) -> String {

//     let bytes = x.to_repr();

//     format!(
//         "0x{}",
//         hex::encode(bytes)
//     )
// }

pub fn fp_to_hex(x: Fp) -> String {

    let mut bytes = x.to_repr();

    bytes.as_mut().reverse();

    format!(
        "0x{}",
        hex::encode(bytes)
    )
}


/*
 * A26 (2026-09-12) — `rho` duoc LAY MAU O RUST, trong truong.
 *
 * Truoc day Node sinh `rho`: ADV `crypto.randomBytes(32)`, ONC
 * `crypto.randomBytes(31)` — hai nhanh lech nhau, va ban 32 byte co
 * ~75 % gia tri >= p nen bi `decimal_string_to_fp` thu gon AM THAM
 * (phan phoi lech), con ban 31 byte thi vut di 7-8 bit entropy de ne
 * modulus. Ca hai deu la cach vong.
 *
 * Cach dung: LAY MAU BAC BO. Rut 32 byte ngau nhien tu OsRng, nhan
 * neu gia tri < p (tuc `from_repr` tra ve Some), khong thi rut lai.
 * Ket qua deu TUYET DOI tren [0, p), khong lech, khong mat entropy.
 * Ty le nhan ~ p / 2^256 ~ 25 % nen trung binh ~4 lan rut.
 */
pub fn random_fp() -> Fp {
    use rand_core::{OsRng, RngCore};

    loop {
        let mut bytes = [0u8; 32];

        OsRng.fill_bytes(&mut bytes);

        let mut repr =
            <Fp as PrimeField>::Repr::default();

        repr.as_mut()
            .copy_from_slice(&bytes);

        if let Some(value) =
            Option::<Fp>::from(
                Fp::from_repr(repr)
            )
        {
            return value;
        }
    }
}


/*
 * Chi in ra `rho` duoi dang word 32 byte. Node doi sang chuoi thap
 * phan de giu nguyen dinh dang note dang dung — do la DINH DANG,
 * khong phai mat ma.
 */
pub fn generate_rho_only() {
    println!(
        "{}",
        serde_json::json!({
            "rho": fp_to_hex(random_fp())
        })
    );
}




// pub fn hex_to_fp(hex_str: &str) -> Fp {

//     let hex_str =
//         hex_str.trim_start_matches("0x");

//     let bytes =
//         hex::decode(hex_str)
//             .unwrap();

//     let mut repr =
//         <Fp as PrimeField>::Repr::default();

//     repr.as_mut()
//         .copy_from_slice(&bytes);

//     Fp::from_repr(repr)
//         .unwrap()
// }



pub fn hex_to_fp(hex_str: &str) -> Fp {

    let hex_str =
        hex_str.trim_start_matches("0x");

    let mut bytes =
        hex::decode(hex_str)
            .unwrap();

    bytes.reverse();

    let mut repr =
        <Fp as PrimeField>::Repr::default();

    repr.as_mut()
        .copy_from_slice(&bytes);

    Fp::from_repr(repr)
        .unwrap()
}




pub fn decimal_string_to_fp(value: &str) -> Fp {

    let mut result =
        Fp::from(0);

    for byte in value.bytes() {

        if byte < b'0' || byte > b'9' {
            panic!("rho must be decimal string");
        }

        let digit =
            (byte - b'0') as u64;

        result =
            result * Fp::from(10)
            + Fp::from(digit);
    }

    result
}