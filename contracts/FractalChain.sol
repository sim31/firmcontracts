// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

import "./FirmChain.sol";

contract FractalChain is FirmChain {

    address key;

    uint8 constant MAX_PARTS = 254;
    uint8 constant NO_PART   = 255;

    struct Part {
        string  name;
        address addr;
    }

    struct BreakOutGroup {
        // Contains indexes to parts
        // Index NO_PART (255) means empty participant (to be used when there are less than 6 people in a break-out room)
        uint8[6] levels;
        uint8    delegate;
    }

    struct Meeting {
        uint       timestamp;
        BreakOutGroup[] groups;
    }

    struct MetaCouncil {
        // Array of 4 dynamic arrays;
        // 4 councils of arbitrary number of delegates;
        uint8[][4] councils;
    }

    Part[MAX_PARTS] public parts; 
    Meeting[]       public meetings;


    function execute(Block calldata bl) internal override {
        // TODO: 
        // * parse commands from blockData
        // * parse ADD_MEETING(Meeting)
        //   * Store it in meetings;
        // * parse ADD_PART(index Part), REMOVE_PART(index)
        //   * Store and empty parts accordingly
        // * Call execute of parent
    }

    function getActiveDelegateIds() public pure returns(MetaCouncil memory) {
        MetaCouncil memory r;
        for (uint i = 1; i <= 4 && i <= meetings.length; i++) {
            uint meetingId = meetings.length - i;
            BreakOutGroup[] storage groups = meetings[meetingId].groups;
            r.councils[i-1] = new uint8[](groups.length);
            for (uint j = 0; j < groups.length; j++) {
                r.councils[i-1][j] = groups[j].delegate;
            }
        }
        return r;
    }
}