use super::arguments::parse_requester_pid;
use super::*;

#[test]
fn accepts_only_a_nonzero_requester_process() {
    assert_eq!(
        parse_requester_pid(&["--requester-pid".to_owned(), "42".to_owned()]).expect("pid"),
        42
    );
    assert!(parse_requester_pid(&["--requester-pid".to_owned(), "0".to_owned()]).is_err());
    assert!(parse_requester_pid(&["--user-sid".to_owned(), "S-1-5-18".to_owned()]).is_err());
    assert!(parse_requester_pid(&[]).is_err());
}

#[test]
fn reads_the_requesting_non_elevated_process_token() {
    let (_token, storage) = requester_sid_storage(std::process::id()).expect("user token");
    let requester = unsafe { &*(storage.as_ptr().cast::<TokenUser>()) };
    assert!(!requester.user.sid.is_null());
}

#[test]
fn treats_existing_membership_as_success() {
    assert_eq!(
        accept_membership_result(0).expect("addition"),
        MembershipResult::Added
    );
    assert_eq!(
        accept_membership_result(result::ERROR_MEMBER_IN_ALIAS).expect("membership"),
        MembershipResult::AlreadyMember
    );
    assert!(accept_membership_result(5).is_err());
}
