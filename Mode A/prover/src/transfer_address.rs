use pasta_curves::Fp;
use ff::PrimeField;

// pub fn eth_address_to_fp(addr: &str) -> Fp {

//     // =========================
//     // Remove 0x
//     // =========================
//     let clean = addr.trim_start_matches("0x");

//     // =========================
//     // Hex -> BigUint
//     // =========================
//     let big = BigUint::parse_bytes(
//         clean.as_bytes(),
//         16
//     ).unwrap();

//     // =========================
//     // BigUint -> little endian bytes
//     // =========================
//     let bytes = big.to_bytes_le();

//     // =========================
//     // Pad to 32 bytes
//     // =========================
//     let mut repr = [0u8; 32];

//     for (i, b) in bytes.iter().enumerate() {
//         repr[i] = *b;
//     }

//     // =========================
//     // bytes -> Fp
//     // =========================
//     Fp::from_repr(repr).unwrap()
// }





// pub fn fp_to_eth_address(fp: Fp) -> String {

//     // =========================
//     // Field -> 32 bytes repr
//     // =========================
//     let repr = fp.to_repr();

//     // =========================
//     // lấy 20 bytes cuối (Ethereum address = 160-bit)
//     // =========================
//     let addr_bytes = &repr[0..20];

//     // =========================
//     // convert to hex
//     // =========================
//     let mut hex_str = String::from("0x");

//     for b in addr_bytes.iter() {
//         hex_str.push_str(&format!("{:02x}", b));
//     }

//     hex_str
// }




pub fn eth_address_to_fp(addr: &str) -> Fp {

    let clean =
        addr.trim_start_matches("0x");

    // hex -> bytes
    let bytes =
        hex::decode(clean).unwrap();

    // pad lên 32 bytes
    let mut repr = [0u8; 32];

    // copy vào 20 bytes cuối
    repr[12..32].copy_from_slice(&bytes);

    // IMPORTANT:
    // Fp dùng little-endian
    repr.reverse();

    Fp::from_repr(repr).unwrap()
}



pub fn fp_to_eth_address(fp: Fp) -> String {

    // lấy repr little-endian
    let mut repr = fp.to_repr();

    // convert về big-endian
    repr.reverse();

    // Ethereum address nằm ở 20 bytes cuối
    let addr_bytes = &repr[12..32];

    format!("0x{}", hex::encode(addr_bytes))
}



/*
 * A25 — ví nhận tiền là public input thứ 4.
 *
 * Nhận địa chỉ 20 byte ("0x" + 40 hex) HOẶC word 32 byte ("0x" + 64 hex,
 * 12 byte đầu bằng 0) — word 32 byte là dạng prover xuất ra, và cũng là
 * cách Solidity mã hoá `address`. Mọi dạng khác là lỗi đầu vào.
 */
pub fn recipient_to_fp(value: &str) -> Fp {

    let clean =
        value.trim_start_matches("0x");

    if !clean.chars().all(|c| c.is_ascii_hexdigit()) {
        panic!("recipient phải là chuỗi hex: {}", value);
    }

    match clean.len() {
        40 => eth_address_to_fp(clean),

        64 => {
            let bytes =
                hex::decode(clean).unwrap();

            if bytes[..12].iter().any(|b| *b != 0) {
                panic!(
                    "recipient 32 byte có 12 byte đầu khác 0 — không phải địa chỉ: {}",
                    value
                );
            }

            eth_address_to_fp(&hex::encode(&bytes[12..]))
        }

        _ => panic!(
            "recipient phải là địa chỉ 20 byte hoặc word 32 byte, nhận được: {}",
            value
        ),
    }
}
