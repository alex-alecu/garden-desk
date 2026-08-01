pub(super) const ERROR_MEMBER_IN_ALIAS: u32 = 1378;
pub const ALREADY_MEMBER_EXIT_CODE: i32 = 2;

#[derive(Debug, Eq, PartialEq)]
pub enum MembershipResult {
    Added,
    AlreadyMember,
}
