# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from genlayer import *


@gl.evm.contract_interface
class _EoaRecipient:
    class View:
        pass

    class Write:
        pass


class PayableProbe(gl.Contract):
    deposits: TreeMap[Address, u256]
    last_value: u256
    last_nondet: str

    def __init__(self):
        self.last_value = u256(0)
        self.last_nondet = ""

    @gl.public.write.payable
    def deposit(self) -> int:
        sender = gl.message.sender_address
        self.deposits[sender] = self.deposits.get(sender, u256(0)) + gl.message.value
        self.last_value = gl.message.value
        return int(self.balance)

    @gl.public.write
    def withdraw_ic_emit_transfer(self, amount: int) -> int:
        if amount <= 0:
            raise gl.vm.UserError("INVALID_AMOUNT")
        gl.get_contract_at(gl.message.sender_address).emit_transfer(
            value=u256(amount),
            on="finalized",
        )
        return amount

    @gl.public.write
    def withdraw_evm_interface(self, amount: int) -> int:
        if amount <= 0:
            raise gl.vm.UserError("INVALID_AMOUNT")
        _EoaRecipient(gl.message.sender_address).emit_transfer(value=u256(amount))
        return amount

    @gl.public.write
    def test_run_nondet(self) -> str:
        res = gl.vm.run_nondet(
            lambda: "nondet_ok",
            lambda r: "nondet_ok" if isinstance(r, gl.vm.Return) and r.calldata == "nondet_ok" else "nondet_other",
        )
        self.last_nondet = str(res)
        return self.last_nondet

    @gl.public.view
    def get_state(self) -> str:
        return json.dumps(
            {
                "contract_balance": int(self.balance),
                "last_value": int(self.last_value),
                "last_nondet": self.last_nondet,
            },
            sort_keys=True,
        )
